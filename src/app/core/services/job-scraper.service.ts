import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError, retry, timeout } from 'rxjs/operators';
import { SettingsService } from './settings.service';
import { JobTitle, GrokRequest, GrokResponse } from '../../shared/interfaces/data-models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';

export interface JobSearchResult {
  success: boolean;
  jobs: JobTitle[];
  source: 'live' | 'cached' | 'default';
  timestamp: string;
  query?: string;
  error?: string;
  cacheAge?: number; // Age in minutes for cached results
}

@Injectable({
  providedIn: 'root'
})
export class JobScraperService {
  private readonly apiUrl = APP_CONSTANTS.GROK_API.BASE_URL;
  private readonly cacheKey = 'cached_job_titles';
  private readonly cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
  
  constructor(
    private http: HttpClient,
    private settingsService: SettingsService
  ) {}

  /**
   * Fetch trending tech job titles using Grok Live Search with smart caching
   */
  fetchTrendingJobs(query?: string, maxResults: number = 10, forceRefresh: boolean = false): Observable<JobSearchResult> {
    console.log('=====================================');
    console.log('🚀 FETCHING TRENDING JOBS');
    console.log('=====================================');
    console.log('Query:', query || 'None (default trending)');
    console.log('Max Results:', maxResults);
    console.log('Force Refresh:', forceRefresh);
    console.log('Timestamp:', new Date().toISOString());
    
    const apiKey = this.settingsService.getGrokApiKey();
    
    // Require API key - no fallbacks
    if (!apiKey) {
      console.error('❌ No API key found!');
      return throwError(() => new Error('Grok API key is required for job fetching. Please configure your API key in settings.'));
    }
    
    console.log('✅ API Key found:', `${apiKey.substring(0, 10)}...` );
    
    // Check cache first (only for general searches without specific query)
    if (!forceRefresh && !query) {
      console.log('📦 Checking cache...');
      const cachedResult = this.getCachedJobs();
      if (cachedResult) {
        console.log('✅ Cache hit! Using cached results');
        console.log('Cache age:', cachedResult.cacheAge, 'minutes');
        console.log('Cached jobs count:', cachedResult.jobs.length);
        return of(cachedResult);
      }
      console.log('❌ Cache miss or expired');
    }
    
    // Use Grok API with Live Search to get current job market data
    console.log('🌐 Making API request to Grok...');
    const startTime = Date.now();
    
    return this.searchJobsWithGrok(apiKey, query, maxResults).pipe(
      map(jobs => {
        const duration = Date.now() - startTime;
        console.log(`✅ API request completed in ${duration}ms`);
        console.log('Jobs received:', jobs.length);
        if (jobs.length === 0) {
          throw new Error('No jobs found in live search results. Try a different search query or check your internet connection.');
        }
        
        const result: JobSearchResult = {
          success: true,
          jobs,
          source: 'live',
          timestamp: new Date().toISOString(),
          query
        };
        
        // Cache the result if it's a general search (no specific query)
        if (!query) {
          this.cacheJobs(result);
        }
        
        return result;
      }),
      catchError(error => {
        const duration = Date.now() - startTime;
        console.error('=====================================');
        console.error(`❌ API REQUEST FAILED after ${duration}ms`);
        console.error('=====================================');
        console.error('Error details:', error);
        console.error('Error status:', error.status);
        console.error('Error message:', error.message);
        if (error.error) {
          console.error('Error body:', error.error);
        }
        console.error('Stack trace:', error.stack);
        return throwError(() => new Error(`Live job search failed: ${error.message}`));
      })
    );
  }

  /**
   * Search for jobs using Grok API with Live Search
   */
  private searchJobsWithGrok(apiKey: string, query?: string, maxResults: number = 10): Observable<JobTitle[]> {
    const searchQuery = query || 'trending technology job titles 2025';
    const prompt = this.createJobSearchPrompt(searchQuery, maxResults);
    
    console.log('-------------------------------------');
    console.log('📝 PREPARING GROK API REQUEST');
    console.log('-------------------------------------');
    console.log('Search Query:', searchQuery);
    console.log('Prompt length:', prompt.length, 'characters');
    
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    });
    
    const request: GrokRequest = {
      model: APP_CONSTANTS.GROK_API.MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a job market analyst with expertise in technology careers. Use current data to provide the most relevant and in-demand job titles.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1000,
      search_parameters: {
        mode: APP_CONSTANTS.GROK_API.LIVE_SEARCH_CONFIG.mode,
        return_citations: APP_CONSTANTS.GROK_API.LIVE_SEARCH_CONFIG.return_citations,
        sources: [...APP_CONSTANTS.GROK_API.LIVE_SEARCH_CONFIG.sources, { type: 'news' }],
        from_date: '2025-06-01', // 3 months before Sept 2025
        to_date: '2025-09-01' // Early Sept 2025 (should have data)
      }
    };
    
    console.log('Request Configuration:');
    console.log('- Model:', request.model);
    console.log('- Temperature:', request.temperature);
    console.log('- Max Tokens:', request.max_tokens);
    console.log('- Reasoning Effort:', request.reasoning_effort);
    console.log('- Search Mode:', request.search_parameters?.mode);
    console.log('- Sources:', request.search_parameters?.sources);
    console.log('- Date Range:', request.search_parameters?.from_date, 'to', request.search_parameters?.to_date);
    console.log('Full Request Body:', JSON.stringify(request, null, 2));
    
    console.log('🔗 API URL:', this.apiUrl);
    console.log('🔑 Auth Header:', `Bearer ${apiKey.substring(0, 10)}...`);
    
    return this.http.post<GrokResponse>(this.apiUrl, request, { headers }).pipe(
      map(response => {
        console.log('-------------------------------------');
        console.log('✅ GROK API RESPONSE RECEIVED');
        console.log('-------------------------------------');
        console.log('Response ID:', response.id);
        console.log('Model used:', response.model);
        console.log('Token usage:', response.usage);
        if (response.usage?.num_sources_used !== undefined) {
          console.log('Sources used:', response.usage.num_sources_used);
        }
        console.log('Content length:', response.choices[0]?.message?.content?.length || 0, 'characters');
        console.log('Raw content preview:', response.choices[0]?.message?.content?.substring(0, 200) + '...');
        
        return this.parseJobsFromResponse(response);
      }),
      retry(1),
      timeout(15000),
      catchError(error => {
        console.error('❌ Grok API HTTP error:', error);
        console.error('Status:', error.status);
        console.error('Status Text:', error.statusText);
        console.error('Error Body:', error.error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Create prompt for job search
   */
  private createJobSearchPrompt(query: string, maxResults: number): string {
    return `Based on current job market data and trends, provide the ${maxResults} most in-demand technology job titles.

Search focus: ${query}

Consider:
1. Current hiring trends in tech companies
2. Emerging technologies and roles
3. High-growth areas (AI/ML, cloud, security, etc.)
4. Both established and emerging positions

IMPORTANT: Return ONLY a JSON array of job titles, no explanations or additional text.

Format your response EXACTLY like this:
[
  "Job Title 1",
  "Job Title 2",
  "Job Title 3"
]

Ensure job titles are:
- Professional and commonly used in the industry
- Not overly specific (avoid company-specific titles)
- Covering a range of seniority levels
- Relevant to current market demands`;
  }

  /**
   * Parse jobs from Grok response
   */
  private parseJobsFromResponse(response: GrokResponse): JobTitle[] {
    console.log('-------------------------------------');
    console.log('🔄 PARSING JOB TITLES FROM RESPONSE');
    console.log('-------------------------------------');
    
    try {
      // Check both content and reasoning_content fields
      const message = response.choices[0]?.message;
      let content = message?.content;
      
      // If content is empty, check reasoning_content
      if (!content || content === '') {
        content = (message as any)?.reasoning_content;
        if (content) {
          console.log('📝 Using reasoning_content field instead of content');
        }
      }
      
      if (!content) {
        console.error('❌ No content or reasoning_content in response');
        throw new Error('No content in response');
      }
      
      console.log('Content to parse:', content);
      
      // Try to parse as JSON array
      let jobTitles: string[] = [];
      
      // First try direct JSON parsing
      try {
        jobTitles = JSON.parse(content);
      } catch {
        // If not valid JSON, try to extract from text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          jobTitles = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback: extract lines that look like job titles
          jobTitles = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 3 && !line.startsWith('[') && !line.startsWith(']'))
            .map(line => line.replace(/^[-*•]\s*/, '').replace(/^"\s*|\s*"$/g, '').replace(/,$/g, ''))
            .filter(line => line.length > 0);
        }
      }
      
      console.log('Parsed job titles array:', jobTitles);
      console.log('Number of jobs parsed:', jobTitles.length);
      
      // Convert to JobTitle format
      const formattedJobs = jobTitles
        .slice(0, 15) // Limit to 15 jobs
        .map((title, index) => ({
          id: `grok-${Date.now()}-${index}`,
          label: this.normalizeJobTitle(title)
        }));
      
      console.log('✅ Successfully parsed', formattedJobs.length, 'job titles');
      formattedJobs.forEach((job, index) => {
        console.log(`  ${index + 1}. ${job.label}`);
      });
      
      return formattedJobs;
      
    } catch (error) {
      console.error('❌ Failed to parse jobs from response');
      console.error('Parse error:', error);
      console.error('Response content that failed to parse:', response.choices[0]?.message?.content);
      return [];
    }
  }

  /**
   * Normalize job title format
   */
  private normalizeJobTitle(title: string): string {
    // Clean up the title
    let normalized = title.trim();
    
    // Remove quotes if present
    normalized = normalized.replace(/^["']|["']$/g, '');
    
    // Remove common prefixes/suffixes that might be in the data
    normalized = normalized.replace(/^(Senior |Junior |Lead |Principal |Staff |Entry Level )/i, '');
    
    // Capitalize properly
    normalized = normalized
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    // Handle common acronyms
    normalized = normalized
      .replace(/\bUi\b/g, 'UI')
      .replace(/\bUx\b/g, 'UX')
      .replace(/\bApi\b/g, 'API')
      .replace(/\bMl\b/g, 'ML')
      .replace(/\bAi\b/g, 'AI')
      .replace(/\bIot\b/g, 'IoT')
      .replace(/\bAr\b/g, 'AR')
      .replace(/\bVr\b/g, 'VR')
      .replace(/\bDevops\b/g, 'DevOps')
      .replace(/\bMlops\b/g, 'MLOps');
    
    return normalized;
  }

  /**
   * Get date string for N months ago
   */
  private getDateMonthsAgo(months: number): string {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString().split('T')[0];
  }


  /**
   * Rank job titles by importance/relevance
   */
  rankJobsByImportance(jobs: JobTitle[], context?: string): Observable<JobTitle[]> {
    const apiKey = this.settingsService.getGrokApiKey();
    
    if (!apiKey || jobs.length === 0) {
      return of(jobs);
    }
    
    const prompt = `Rank these job titles by their current market importance and career potential in ${context || 'technology'}:

Job titles: ${jobs.map(j => j.label).join(', ')}

Return a JSON array of the job titles in order of importance (most important first).
Consider: market demand, salary potential, growth prospects, and skill requirements.

Format: ["Job 1", "Job 2", ...]`;
    
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    });
    
    const request: GrokRequest = {
      model: APP_CONSTANTS.GROK_API.MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a career advisor ranking jobs by importance.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
      reasoning_effort: 'low'
    };
    
    return this.http.post<GrokResponse>(this.apiUrl, request, { headers }).pipe(
      map(response => {
        try {
          const content = response.choices[0]?.message?.content;
          const rankedTitles = JSON.parse(content);
          
          // Reorder the input jobs based on the ranking
          const rankedJobs: JobTitle[] = [];
          rankedTitles.forEach((title: string) => {
            const job = jobs.find(j => j.label.toLowerCase() === title.toLowerCase());
            if (job) {
              rankedJobs.push(job);
            }
          });
          
          // Add any jobs that weren't ranked at the end
          jobs.forEach(job => {
            if (!rankedJobs.find(j => j.id === job.id)) {
              rankedJobs.push(job);
            }
          });
          
          return rankedJobs;
        } catch (error) {
          console.error('Failed to parse ranking:', error);
          return jobs; // Return original order on error
        }
      }),
      catchError(() => of(jobs)),
      timeout(10000)
    );
  }

  /**
   * Cache job search results
   */
  private cacheJobs(result: JobSearchResult): void {
    try {
      const cacheData = {
        ...result,
        cachedAt: Date.now()
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('Failed to cache job titles:', error);
    }
  }

  /**
   * Get cached jobs if available and not expired
   */
  private getCachedJobs(): JobSearchResult | null {
    try {
      const cached = localStorage.getItem(this.cacheKey);
      if (!cached) return null;
      
      const data = JSON.parse(cached);
      const age = Date.now() - (data.cachedAt || 0);
      
      if (age > this.cacheDuration) {
        localStorage.removeItem(this.cacheKey);
        return null;
      }
      
      return {
        ...data,
        source: 'cached' as const,
        cacheAge: Math.floor(age / (1000 * 60)) // Age in minutes
      };
    } catch (error) {
      console.warn('Failed to read cached jobs:', error);
      return null;
    }
  }

  /**
   * Clear job cache (force refresh)
   */
  clearCache(): void {
    try {
      localStorage.removeItem(this.cacheKey);
    } catch (error) {
      console.warn('Failed to clear job cache:', error);
    }
  }

  /**
   * Get cache age in human readable format
   */
  getCacheAge(): string | null {
    try {
      const cached = localStorage.getItem(this.cacheKey);
      if (!cached) return null;
      
      const data = JSON.parse(cached);
      const age = Date.now() - (data.cachedAt || 0);
      const minutes = Math.floor(age / (1000 * 60));
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      } else {
        return 'Just now';
      }
    } catch (error) {
      return null;
    }
  }
}