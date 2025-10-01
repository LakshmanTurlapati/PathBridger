import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, timeout } from 'rxjs/operators';
import { JobTitle, GrokRequest, GrokResponse } from '../../shared/interfaces/data-models';
import { SettingsService } from './settings.service';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';

export interface JobSkillExtraction {
  jobTitle: string;
  jobId: string;
  extractedSkills: string[];
  requiredTechnologies: string[];
  experienceLevel: string;
  keyResponsibilities: string[];
  educationalRequirements?: string[];
  confidence: number;
}

export interface SyllabusGapAnalysis {
  jobTitle: string;
  jobDescription: string;
  matchedTopics: string[];
  missingSkills: string[];
  suggestedTopics: string[];
  syllabusEnhancements: SyllabusEnhancement[];
  alignmentScore: number;
}

export interface SyllabusEnhancement {
  weekNumber?: number;
  currentTopic?: string;
  suggestedAddition: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
  sourceJobRequirement: string;
}

@Injectable({
  providedIn: 'root'
})
export class JobDescriptionAnalysisService {
  private readonly apiUrl = APP_CONSTANTS.GROK_API.BASE_URL;
  
  constructor(
    private http: HttpClient,
    private settingsService: SettingsService
  ) {}

  /**
   * Extract skills and requirements from job description
   */
  extractSkillsFromJobDescription(job: JobTitle): Observable<JobSkillExtraction> {
    const apiKey = this.settingsService.getGrokApiKey();
    
    if (!apiKey || !job.description) {
      // Return basic extraction if no API key or description
      return of(this.createBasicExtraction(job));
    }

    const prompt = this.createSkillExtractionPrompt(job);
    
    return this.callGrokApi(prompt, apiKey).pipe(
      map(response => this.parseSkillExtraction(response, job)),
      catchError(() => of(this.createBasicExtraction(job)))
    );
  }

  /**
   * Analyze syllabus gaps based on job description
   */
  analyzeSyllabusGapsWithJobDescription(
    job: JobTitle,
    courseTopics: string[],
    courseSyllabus?: any
  ): Observable<SyllabusGapAnalysis> {
    const apiKey = this.settingsService.getGrokApiKey();
    
    if (!apiKey || !job.description) {
      return of(this.createBasicGapAnalysis(job, courseTopics));
    }

    const prompt = this.createGapAnalysisPrompt(job, courseTopics, courseSyllabus);
    
    return this.callGrokApi(prompt, apiKey).pipe(
      map(response => this.parseGapAnalysis(response, job)),
      catchError(() => of(this.createBasicGapAnalysis(job, courseTopics)))
    );
  }

  /**
   * Generate syllabus enhancements based on job descriptions
   */
  generateSyllabusEnhancements(
    jobs: JobTitle[],
    currentSyllabus: any
  ): Observable<SyllabusEnhancement[]> {
    const apiKey = this.settingsService.getGrokApiKey();
    
    if (!apiKey) {
      return of([]);
    }

    // Filter jobs with descriptions
    const jobsWithDescriptions = jobs.filter(j => j.description);
    
    if (jobsWithDescriptions.length === 0) {
      return of([]);
    }

    const prompt = this.createEnhancementPrompt(jobsWithDescriptions, currentSyllabus);
    
    return this.callGrokApi(prompt, apiKey).pipe(
      map(response => this.parseEnhancements(response)),
      catchError(() => of([]))
    );
  }

  /**
   * Batch analyze multiple jobs for comprehensive gap analysis
   */
  batchAnalyzeJobDescriptions(
    jobs: JobTitle[],
    courses: any[]
  ): Observable<Map<string, JobSkillExtraction>> {
    const apiKey = this.settingsService.getGrokApiKey();
    
    if (!apiKey) {
      return of(new Map());
    }

    const jobsWithDescriptions = jobs.filter(j => j.description);
    
    if (jobsWithDescriptions.length === 0) {
      return of(new Map());
    }

    // Process in batches to avoid overwhelming the API
    const batchSize = 5;
    const batches = [];
    
    for (let i = 0; i < jobsWithDescriptions.length; i += batchSize) {
      const batch = jobsWithDescriptions.slice(i, i + batchSize);
      batches.push(this.processBatch(batch));
    }

    return forkJoin(batches).pipe(
      map(results => {
        const skillMap = new Map<string, JobSkillExtraction>();
        results.flat().forEach(extraction => {
          skillMap.set(extraction.jobId, extraction);
        });
        return skillMap;
      }),
      catchError(() => of(new Map()))
    );
  }

  private processBatch(jobs: JobTitle[]): Observable<JobSkillExtraction[]> {
    return forkJoin(
      jobs.map(job => this.extractSkillsFromJobDescription(job))
    );
  }

  private createSkillExtractionPrompt(job: JobTitle): string {
    return `Analyze this job posting and extract key requirements:

Job Title: ${job.label}
Company: ${job.company || 'Not specified'}
Description: ${job.description}
Current Skills Listed: ${job.skills?.join(', ') || 'None specified'}

Extract and return as JSON:
{
  "extractedSkills": ["skill1", "skill2", ...],
  "requiredTechnologies": ["tech1", "tech2", ...],
  "experienceLevel": "entry|mid|senior|lead",
  "keyResponsibilities": ["resp1", "resp2", ...],
  "educationalRequirements": ["req1", "req2", ...],
  "confidence": 0.85
}

Focus on:
1. Technical skills and programming languages
2. Frameworks and tools mentioned
3. Domain-specific knowledge required
4. Soft skills if emphasized
5. Certifications or specific educational needs`;
  }

  private createGapAnalysisPrompt(job: JobTitle, courseTopics: string[], syllabus?: any): string {
    const syllabusContext = syllabus ? `\nCurrent syllabus weeks:\n${JSON.stringify(syllabus.weeks || [], null, 2)}` : '';
    
    return `Analyze how well this course covers the job requirements:

JOB DETAILS:
Title: ${job.label}
Company: ${job.company || 'Not specified'}
Description: ${job.description}
Required Skills: ${job.skills?.join(', ') || 'Not specified'}

COURSE TOPICS:
${courseTopics.join(', ')}
${syllabusContext}

Analyze and return as JSON:
{
  "matchedTopics": ["topic1", "topic2"],
  "missingSkills": ["skill1", "skill2"],
  "suggestedTopics": ["new_topic1", "new_topic2"],
  "syllabusEnhancements": [
    {
      "weekNumber": 3,
      "currentTopic": "existing topic",
      "suggestedAddition": "new subtopic or lab",
      "rationale": "why this is needed",
      "priority": "high",
      "sourceJobRequirement": "specific JD requirement"
    }
  ],
  "alignmentScore": 0.75
}

Consider:
1. Direct skill matches
2. Foundational topics that support job skills
3. Practical applications mentioned in JD
4. Industry tools and frameworks from JD
5. Specific technologies the company uses`;
  }

  private createEnhancementPrompt(jobs: JobTitle[], currentSyllabus: any): string {
    const jobSummaries = jobs.map(j => `${j.label}: ${j.description?.substring(0, 200)}...`).join('\n');
    
    return `Based on these job descriptions, suggest syllabus enhancements:

JOBS ANALYZED:
${jobSummaries}

CURRENT SYLLABUS:
${JSON.stringify(currentSyllabus, null, 2)}

Generate practical enhancements as JSON array:
[
  {
    "weekNumber": 3,
    "suggestedAddition": "Add hands-on lab with Docker containers",
    "rationale": "3 jobs require containerization skills",
    "priority": "high",
    "sourceJobRequirement": "Docker and Kubernetes experience"
  }
]

Focus on:
1. Most commonly required skills across jobs
2. Practical, hands-on additions
3. Industry-standard tools and practices
4. Skills gaps that appear in multiple JDs
5. Modern technologies mentioned in descriptions`;
  }

  private callGrokApi(prompt: string, apiKey: string): Observable<GrokResponse> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    });

    const request: GrokRequest = {
      model: APP_CONSTANTS.GROK_API.MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing job descriptions and curriculum design. Extract specific, actionable requirements from job descriptions and map them to educational topics.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1000
    };

    return this.http.post<GrokResponse>(this.apiUrl, request, { headers }).pipe(
      timeout(15000)
    );
  }

  private parseSkillExtraction(response: GrokResponse, job: JobTitle): JobSkillExtraction {
    try {
      const content = response.choices[0]?.message?.content;
      const parsed = JSON.parse(content);
      
      return {
        jobTitle: job.label,
        jobId: job.id,
        extractedSkills: parsed.extractedSkills || [],
        requiredTechnologies: parsed.requiredTechnologies || [],
        experienceLevel: parsed.experienceLevel || 'mid',
        keyResponsibilities: parsed.keyResponsibilities || [],
        educationalRequirements: parsed.educationalRequirements,
        confidence: parsed.confidence || 0.7
      };
    } catch {
      return this.createBasicExtraction(job);
    }
  }

  private parseGapAnalysis(response: GrokResponse, job: JobTitle): SyllabusGapAnalysis {
    try {
      const content = response.choices[0]?.message?.content;
      const parsed = JSON.parse(content);
      
      return {
        jobTitle: job.label,
        jobDescription: job.description || '',
        matchedTopics: parsed.matchedTopics || [],
        missingSkills: parsed.missingSkills || [],
        suggestedTopics: parsed.suggestedTopics || [],
        syllabusEnhancements: parsed.syllabusEnhancements || [],
        alignmentScore: parsed.alignmentScore || 0.5
      };
    } catch {
      return this.createBasicGapAnalysis(job, []);
    }
  }

  private parseEnhancements(response: GrokResponse): SyllabusEnhancement[] {
    try {
      const content = response.choices[0]?.message?.content;
      return JSON.parse(content) || [];
    } catch {
      return [];
    }
  }

  private createBasicExtraction(job: JobTitle): JobSkillExtraction {
    return {
      jobTitle: job.label,
      jobId: job.id,
      extractedSkills: job.skills || [],
      requiredTechnologies: [],
      experienceLevel: job.experienceLevel || 'mid',
      keyResponsibilities: [],
      educationalRequirements: [],
      confidence: 0.5
    };
  }

  private createBasicGapAnalysis(job: JobTitle, courseTopics: string[]): SyllabusGapAnalysis {
    return {
      jobTitle: job.label,
      jobDescription: job.description || '',
      matchedTopics: [],
      missingSkills: job.skills || [],
      suggestedTopics: [],
      syllabusEnhancements: [],
      alignmentScore: 0.3
    };
  }

  /**
   * Check if course topics cover job description requirements
   */
  calculateJobDescriptionCoverage(
    job: JobTitle,
    courseTopics: string[]
  ): number {
    if (!job.description || !job.skills) {
      return 0.5; // Default coverage if no data
    }

    const jobSkills = job.skills.map(s => s.toLowerCase());
    const topics = courseTopics.map(t => t.toLowerCase());
    
    let matchCount = 0;
    jobSkills.forEach(skill => {
      if (topics.some(topic => 
        topic.includes(skill) || 
        skill.includes(topic) ||
        this.areSkillsRelated(skill, topic)
      )) {
        matchCount++;
      }
    });

    return jobSkills.length > 0 ? matchCount / jobSkills.length : 0;
  }

  private areSkillsRelated(skill1: string, skill2: string): boolean {
    const synonyms: Map<string, string[]> = new Map([
      ['javascript', ['js', 'node', 'nodejs', 'typescript', 'ts']],
      ['python', ['py', 'django', 'flask', 'pandas']],
      ['database', ['sql', 'nosql', 'mongodb', 'postgres', 'mysql']],
      ['cloud', ['aws', 'azure', 'gcp', 'docker', 'kubernetes']],
      ['ml', ['machine learning', 'ai', 'artificial intelligence', 'deep learning']]
    ]);

    for (const [key, values] of synonyms) {
      if ((skill1.includes(key) || values.some(v => skill1.includes(v))) &&
          (skill2.includes(key) || values.some(v => skill2.includes(v)))) {
        return true;
      }
    }

    return false;
  }
}