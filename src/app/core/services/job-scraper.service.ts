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
  private readonly responsesUrl = APP_CONSTANTS.GROK_API.RESPONSES_URL;
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
    console.log('[Jobs] Fetching trending jobs');
    console.log('Query:', query || 'None (default trending)');
    console.log('Max Results:', maxResults);
    console.log('Force Refresh:', forceRefresh);
    console.log('Timestamp:', new Date().toISOString());
    
    const apiKey = this.settingsService.getGrokApiKey();
    
    // Require API key - no fallbacks
    if (!apiKey) {
      console.error('[Error] No API key found');
      return throwError(() => new Error('Grok API key is required for job fetching. Please configure your API key in settings.'));
    }
    
    console.log('[Jobs] API Key found:', `${apiKey.substring(0, 10)}...`);
    
    // Check cache first (only for general searches without specific query)
    if (!forceRefresh && !query) {
      console.log('[Cache] Checking cache...');
      const cachedResult = this.getCachedJobs();
      if (cachedResult) {
        console.log('[Cache] Cache hit - using cached results');
        console.log('Cache age:', cachedResult.cacheAge, 'minutes');
        console.log('Cached jobs count:', cachedResult.jobs.length);
        return of(cachedResult);
      }
      console.log('[Cache] Cache miss or expired');
    }
    
    // Use Grok API with Live Search to get current job market data
    console.log('[API] Making API request to Grok...');
    const startTime = Date.now();
    
    return this.searchJobsWithGrok(apiKey, query, maxResults).pipe(
      map(jobs => {
        const duration = Date.now() - startTime;
        console.log(`[API] Request completed in ${duration}ms`);
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
        console.warn(`[Jobs] API request failed after ${duration}ms, using default jobs`);
        console.warn('Error:', error.message || error);

        // Return default jobs as fallback instead of failing
        return of({
          success: true,
          jobs: this.getDefaultJobs(),
          source: 'default' as const,
          timestamp: new Date().toISOString(),
          error: `API failed: ${error.message}`
        });
      })
    );
  }

  /**
   * Search for jobs using Grok Responses API with web_search tool
   * Uses the new Agent Tools API (Live Search is deprecated Dec 15, 2025)
   */
  private searchJobsWithGrok(apiKey: string, query?: string, maxResults: number = 10, useSimplified: boolean = false): Observable<JobTitle[]> {
    const searchQuery = query || 'trending technology job titles 2025';
    const prompt = this.createJobSearchPrompt(searchQuery, maxResults, useSimplified);

    console.log('[API] Preparing Grok Responses API request (web_search tool)');
    console.log('Search Query:', searchQuery);
    console.log('Mode:', useSimplified ? 'Simplified (fallback)' : 'Enhanced (with descriptions)');
    console.log('Prompt length:', prompt.length, 'characters');

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    });

    // Use Responses API format with web_search tool
    const request = {
      model: APP_CONSTANTS.GROK_API.SEARCH_MODEL,
      input: [
        {
          role: 'system',
          content: 'You are a job market analyst. Use web search to find REAL companies that are currently hiring for tech positions. Search job boards and company career pages. Return actual job listings with real company names - do not make up or assume company names.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      tools: APP_CONSTANTS.GROK_API.SEARCH_TOOLS,
      temperature: 0.7,
      max_output_tokens: useSimplified ? 1500 : 4096
    };

    console.log('Request Configuration:');
    console.log('- Model:', request.model);
    console.log('- Temperature:', request.temperature);
    console.log('- Max Output Tokens:', request.max_output_tokens);
    console.log('- Tools:', JSON.stringify(request.tools));
    console.log('[API] URL:', this.responsesUrl);
    console.log('[API] Auth Header:', `Bearer ${apiKey.substring(0, 10)}...`);

    const timeout$ = useSimplified ? 60000 : 90000; // Extended timeout for web_search tool (does 10+ searches)

    return this.http.post<any>(this.responsesUrl, request, { headers }).pipe(
      map(response => {
        console.log('[API] Grok Responses API response received');
        console.log('Response ID:', response.id);
        console.log('Model used:', response.model);
        console.log('Full response structure:', JSON.stringify(response, null, 2).substring(0, 1000));

        return this.parseJobsFromResponsesApi(response);
      }),
      retry(1),
      timeout(timeout$),
      catchError(error => {
        console.error('[Error] Grok Responses API error:', error);
        console.error('Status:', error.status);
        console.error('Status Text:', error.statusText);
        console.error('Error Body:', JSON.stringify(error.error));

        // If this was an enhanced request that timed out, try simplified
        if (!useSimplified && error.name === 'TimeoutError') {
          console.log('[API] Enhanced request timed out, trying simplified prompt...');
          return this.searchJobsWithGrok(apiKey, query, maxResults, true);
        }

        return throwError(() => error);
      })
    );
  }

  /**
   * Create prompt for job search
   */
  private createJobSearchPrompt(query: string, maxResults: number, simplified: boolean = false): string {
    if (simplified) {
      // Simplified prompt for faster response
      return `List ${maxResults} technology companies currently hiring for: ${query}

Return a JSON array with job title and company. Example:
[
  {"title": "Software Engineer", "company": "Google"},
  {"title": "Data Scientist", "company": "Meta"}
]`;
    }

    // Enhanced prompt requesting actual companies hiring
    return `Find ${maxResults} current job openings at tech companies for: ${query}

Search for ACTUAL companies that are currently hiring. Include:
- title: specific job title
- company: name of the company that's hiring (REQUIRED - must be a real company)
- description: brief role description (1-2 sentences)
- sourceUrl: URL of the job posting or careers page (REQUIRED - must be a real URL)
- location: job location if known (optional)
- skills: 3-4 key skills required (optional)

Important: Include REAL company names that are actually hiring, not generic examples.
Focus on well-known tech companies, startups, and companies with open positions.
ALWAYS include the sourceUrl - the actual URL where this job was found.

Example format:
[
  {
    "title": "Senior Software Engineer",
    "company": "Google",
    "description": "Build scalable systems for Google Cloud Platform.",
    "sourceUrl": "https://careers.google.com/jobs/results/123456",
    "location": "Mountain View, CA",
    "skills": ["Java", "Kubernetes", "GCP"]
  },
  {
    "title": "ML Engineer",
    "company": "OpenAI",
    "description": "Work on large language models and AI systems.",
    "sourceUrl": "https://openai.com/careers/ml-engineer",
    "location": "San Francisco, CA",
    "skills": ["Python", "PyTorch", "Transformers"]
  }
]

Return valid JSON with real companies currently hiring in tech.`;
  }

  /**
   * Parse jobs from Grok response
   */
  private parseJobsFromResponse(response: GrokResponse): JobTitle[] {
    console.log('[Parser] Parsing job titles from response');
    
    try {
      // Check both content and reasoning_content fields
      const message = response.choices[0]?.message;
      let content = message?.content;
      
      // If content is empty, check reasoning_content
      if (!content || content === '') {
        content = (message as any)?.reasoning_content;
        if (content) {
          console.log('[Parser] Using reasoning_content field instead of content');
        }
      }
      
      if (!content) {
        console.error('[Error] No content or reasoning_content in response');
        throw new Error('No content in response');
      }
      
      console.log('Content to parse:', content);
      
      // Try to parse as structured JSON array first
      let jobData: any[] = [];
      let isStructuredData = false;
      
      // First try direct JSON parsing
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          // Check if it's structured data (objects with title) or simple strings
          if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
            jobData = parsed;
            isStructuredData = true;
            console.log('[Parser] Parsed structured job data');
          } else if (typeof parsed[0] === 'string') {
            // Legacy format - simple strings
            jobData = parsed.map(title => ({ title }));
            console.log('[Parser] Parsed legacy string format');
          }
        }
      } catch {
        // If not valid JSON, try to extract from text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
                jobData = parsed;
                isStructuredData = true;
              } else if (typeof parsed[0] === 'string') {
                jobData = parsed.map(title => ({ title }));
              }
            }
          } catch {
            console.warn('[Warning] Could not parse extracted JSON');
          }
        }
        
        // Final fallback: extract lines that look like job titles
        if (jobData.length === 0) {
          const titles = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 3 && !line.startsWith('[') && !line.startsWith(']'))
            .map(line => line.replace(/^[-*•]\s*/, '').replace(/^"\s*|\s*"$/g, '').replace(/,$/g, ''))
            .filter(line => line.length > 0);
          
          jobData = titles.map(title => ({ title }));
          console.log('[Parser] Using fallback text extraction');
        }
      }
      
      console.log('Parsed job data:', jobData);
      console.log('Number of jobs parsed:', jobData.length);
      console.log('Is structured data:', isStructuredData);
      
      // Convert to JobTitle format with enhanced fields
      const formattedJobs = jobData
        .slice(0, 15) // Limit to 15 jobs
        .map((job, index) => {
          const jobTitle: JobTitle = {
            id: `grok-${Date.now()}-${index}`,
            label: this.normalizeJobTitle(job.title || job),
            source: 'live',
            fetchedAt: new Date().toISOString()
          };
          
          // Add enhanced fields if available (strip xAI citation markup)
          if (isStructuredData && typeof job === 'object') {
            if (job.description) {
              jobTitle.description = this.stripCitationMarkup(job.description);
            }
            if (job.skills && Array.isArray(job.skills)) {
              jobTitle.skills = job.skills.map((s: string) => this.stripCitationMarkup(s));
            }
            if (job.trends) {
              jobTitle.trends = this.stripCitationMarkup(job.trends);
            }
            if (job.averageSalary) {
              jobTitle.averageSalary = this.stripCitationMarkup(job.averageSalary);
            }
            if (job.experienceLevel) {
              jobTitle.experienceLevel = job.experienceLevel;
            }
            if (job.company) {
              jobTitle.company = this.stripCitationMarkup(job.company);
            }
            if (job.location) {
              jobTitle.location = this.stripCitationMarkup(job.location);
            }
            if (job.sourceUrl) {
              jobTitle.sourceUrl = job.sourceUrl;
            }
          }

          return jobTitle;
        });
      
      console.log('[Parser] Successfully parsed', formattedJobs.length, 'job titles');
      console.log('[Verification] Job data verification:');
      
      let jobsWithDescriptions = 0;
      let jobsWithSkills = 0;
      let jobsWithTrends = 0;
      let jobsWithCompanies = 0;
      let jobsWithLocations = 0;
      
      formattedJobs.forEach((job, index) => {
        console.log(`\n${index + 1}. ${job.label}`);
        
        if (job.company) jobsWithCompanies++;
        if (job.location) jobsWithLocations++;
        if (job.description) jobsWithDescriptions++;
        if (job.skills && job.skills.length > 0) jobsWithSkills++;
        if (job.trends) jobsWithTrends++;
      });

      console.log('[Verification] Summary:', {
        withCompanies: `${jobsWithCompanies}/${formattedJobs.length}`,
        withLocations: `${jobsWithLocations}/${formattedJobs.length}`,
        withDescriptions: `${jobsWithDescriptions}/${formattedJobs.length}`,
        withSkills: `${jobsWithSkills}/${formattedJobs.length}`,
        withTrends: `${jobsWithTrends}/${formattedJobs.length}`
      });
      
      return formattedJobs;

    } catch (error) {
      console.error('[Error] Failed to parse jobs from response');
      console.error('Parse error:', error);
      console.error('Response content that failed to parse:', response.choices[0]?.message?.content);
      return [];
    }
  }

  /**
   * Parse jobs from Grok Responses API (new Agent Tools format)
   */
  private parseJobsFromResponsesApi(response: any): JobTitle[] {
    console.log('[Parser] Parsing job titles from Responses API');

    try {
      // Responses API returns output as an array of items
      const output = response.output;
      if (!output || !Array.isArray(output)) {
        console.error('[Error] No output array in Responses API response');
        throw new Error('No output in response');
      }

      // Find the message item with the final content
      let content = '';
      let toolCallsUsed = 0;

      // Log all output item types for debugging
      console.log('[Parser] Output has', output.length, 'items');
      console.log('[Parser] Item types:', output.map((item: any) => item.type).join(', '));

      for (const item of output) {
        // Detect web_search_call (the actual type xAI uses) or tool_call
        if (item.type === 'web_search_call' || item.type === 'tool_call' || item.type?.includes('_call')) {
          toolCallsUsed++;
          console.log('[Parser] Tool call detected:', item.type, item.action?.query || '');
        }

        // Look for message content - could be type 'message' or have role 'assistant'
        if (item.type === 'message' || item.role === 'assistant') {
          console.log('[Parser] Found message item:', JSON.stringify(item).substring(0, 300));

          // The content can be an array of content blocks or a string
          if (Array.isArray(item.content)) {
            for (const block of item.content) {
              if (block.type === 'text' && block.text) {
                content = block.text;
              } else if (block.type === 'output_text' && block.text) {
                content = block.text;
              } else if (typeof block === 'string') {
                content = block;
              }
            }
          } else if (typeof item.content === 'string') {
            content = item.content;
          } else if (item.text) {
            // Direct text property
            content = item.text;
          }
        }
      }

      console.log('[Parser] Tool calls used:', toolCallsUsed);
      console.log('[Parser] Content found:', content ? content.substring(0, 300) + '...' : 'NONE');

      if (!content) {
        console.error('[Error] No content found in Responses API output');
        throw new Error('No content in response output');
      }

      // Parse the content - same logic as before
      let jobData: any[] = [];
      let isStructuredData = false;

      // Try direct JSON parsing
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
            jobData = parsed;
            isStructuredData = true;
            console.log('[Parser] Parsed structured job data from Responses API');
          } else if (typeof parsed[0] === 'string') {
            jobData = parsed.map(title => ({ title }));
            console.log('[Parser] Parsed string array format');
          }
        }
      } catch {
        // Extract JSON from text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
                jobData = parsed;
                isStructuredData = true;
              } else if (typeof parsed[0] === 'string') {
                jobData = parsed.map(title => ({ title }));
              }
            }
          } catch {
            console.warn('[Warning] Could not parse extracted JSON from Responses API');
          }
        }

        // Fallback: extract lines
        if (jobData.length === 0) {
          const titles = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 3 && !line.startsWith('[') && !line.startsWith(']'))
            .map(line => line.replace(/^[-*•\d.)\s]+/, '').replace(/^"\s*|\s*"$/g, '').replace(/,$/g, ''))
            .filter(line => line.length > 0 && !line.startsWith('{'));

          jobData = titles.slice(0, 15).map(title => ({ title }));
          console.log('[Parser] Using fallback text extraction for Responses API');
        }
      }

      console.log('[Parser] Parsed', jobData.length, 'jobs from Responses API');

      // Convert to JobTitle format
      const formattedJobs = jobData
        .slice(0, 15)
        .map((job, index) => {
          const jobTitle: JobTitle = {
            id: `grok-responses-${Date.now()}-${index}`,
            label: this.normalizeJobTitle(job.title || job),
            source: 'live',
            fetchedAt: new Date().toISOString()
          };

          if (isStructuredData && typeof job === 'object') {
            // Strip xAI citation markup from text fields
            if (job.description) jobTitle.description = this.stripCitationMarkup(job.description);
            if (job.skills && Array.isArray(job.skills)) jobTitle.skills = job.skills.map((s: string) => this.stripCitationMarkup(s));
            if (job.trends) jobTitle.trends = this.stripCitationMarkup(job.trends);
            if (job.averageSalary) jobTitle.averageSalary = this.stripCitationMarkup(job.averageSalary);
            if (job.experienceLevel) jobTitle.experienceLevel = job.experienceLevel;
            if (job.company) jobTitle.company = this.stripCitationMarkup(job.company);
            if (job.location) jobTitle.location = this.stripCitationMarkup(job.location);
            if (job.sourceUrl) jobTitle.sourceUrl = job.sourceUrl;
          }

          return jobTitle;
        });

      console.log('[Parser] Successfully parsed', formattedJobs.length, 'job titles from Responses API');

      // Log verification summary
      const summary = {
        withCompanies: formattedJobs.filter(j => j.company).length,
        withLocations: formattedJobs.filter(j => j.location).length,
        withDescriptions: formattedJobs.filter(j => j.description).length,
        withSkills: formattedJobs.filter(j => j.skills && j.skills.length > 0).length,
        toolCallsUsed
      };
      console.log('[Verification] Responses API Summary:', summary);

      formattedJobs.forEach((job, index) => {
        console.log(`${index + 1}. ${job.label}${job.company ? ' @ ' + job.company : ''}`);
      });

      return formattedJobs;

    } catch (error) {
      console.error('[Error] Failed to parse jobs from Responses API');
      console.error('Parse error:', error);
      // Log more of the response to understand its structure
      const fullResponse = JSON.stringify(response, null, 2);
      console.error('Response length:', fullResponse.length);
      console.error('Raw response (first 2000 chars):', fullResponse.substring(0, 2000));
      if (fullResponse.length > 2000) {
        console.error('Raw response (last 1000 chars):', fullResponse.substring(fullResponse.length - 1000));
      }
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
   * Strip xAI citation markup from text
   * Removes <grok:render>...</grok:render> blocks and other XML tags
   */
  private stripCitationMarkup(text: string): string {
    if (!text) return text;
    return text
      .replace(/<grok:render[^>]*>[\s\S]*?<\/grok:render>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
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
        cachedAt: Date.now(),
        cacheVersion: '2.0' // Version for cache migration handling
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));
      console.log('[Cache] Cached enhanced job data with descriptions');
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
      
      // Check cache version - clear old cache format
      if (!data.cacheVersion || data.cacheVersion < '2.0') {
        console.log('[Cache] Clearing old cache format');
        localStorage.removeItem(this.cacheKey);
        return null;
      }
      
      if (age > this.cacheDuration) {
        localStorage.removeItem(this.cacheKey);
        return null;
      }
      
      // Log if cached jobs have descriptions
      const jobsWithDescriptions = data.jobs?.filter((j: JobTitle) => j.description).length || 0;
      if (jobsWithDescriptions > 0) {
        console.log(`[Cache] Cache contains ${jobsWithDescriptions}/${data.jobs?.length} jobs with descriptions`);
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

  /**
   * Get default job titles when API fails
   * These are common tech roles that are always in demand
   */
  private getDefaultJobs(): JobTitle[] {
    const defaultJobs = [
      { title: 'Software Engineer', description: 'Design and build software applications and systems' },
      { title: 'Data Scientist', description: 'Analyze data and build machine learning models' },
      { title: 'DevOps Engineer', description: 'Manage CI/CD pipelines and cloud infrastructure' },
      { title: 'Full Stack Developer', description: 'Build both frontend and backend applications' },
      { title: 'Machine Learning Engineer', description: 'Develop and deploy ML models at scale' },
      { title: 'Cloud Architect', description: 'Design cloud-based solutions and infrastructure' },
      { title: 'Product Manager', description: 'Lead product development and strategy' },
      { title: 'UX Designer', description: 'Design user experiences and interfaces' },
      { title: 'Security Engineer', description: 'Protect systems and data from threats' },
      { title: 'Backend Developer', description: 'Build server-side applications and APIs' }
    ];

    return defaultJobs.map((job, index) => ({
      id: `default-${Date.now()}-${index}`,
      label: job.title,
      description: job.description,
      source: 'default' as const,
      fetchedAt: new Date().toISOString()
    }));
  }
}