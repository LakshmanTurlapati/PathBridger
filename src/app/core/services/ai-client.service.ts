import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of, forkJoin } from 'rxjs';
import { map, catchError, retry, timeout, switchMap } from 'rxjs/operators';
import { JobDescriptionAnalysisService } from './job-description-analysis.service';
import { 
  AnalysisRequest, 
  AnalysisResponse, 
  GrokRequest, 
  GrokResponse, 
  JobThreshold,
  ThresholdAnalysisResponse,
  SuggestedCourse,
  CourseMapping 
} from '../../shared/interfaces/data-models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class AiClientService {
  private readonly apiUrl = APP_CONSTANTS.GROK_API.BASE_URL;
  private readonly baseTimeout = 45000; // 45 seconds base timeout
  private requestTimeout = this.baseTimeout; // Dynamic timeout

  constructor(
    private http: HttpClient,
    private settingsService: SettingsService,
    private jobDescriptionAnalysis: JobDescriptionAnalysisService
  ) {}

  /**
   * Main analysis method that orchestrates the complete AI workflow
   * Matches V1's analyze_paths_tool functionality
   */
  analyzeCareerPaths(request: AnalysisRequest): Observable<AnalysisResponse> {
    const apiKey = this.settingsService.getGrokApiKey();
    if (!apiKey) {
      return throwError(() => new Error('Grok API key not configured'));
    }

    // Calculate dynamic timeout based on job count and JD presence
    const jobsWithDescriptions = request.job_data?.filter(j => j.description).length || 0;
    this.requestTimeout = this.calculateDynamicTimeout(request.job_titles.length, jobsWithDescriptions);
    console.log(`Using dynamic timeout: ${this.requestTimeout}ms for ${request.job_titles.length} jobs (${jobsWithDescriptions} with descriptions)`);

    // Step 1: Determine educational adequacy thresholds with fallback
    return this.determineThresholdsWithFallback(request, apiKey).pipe(
      // Step 2: Create job-to-course mappings
      switchMap(thresholds => {
        return this.processMappingsAndSuggestions({ thresholds, request, apiKey });
      }),
      catchError(error => this.handleAnalysisError(error))
    );
  }

  /**
   * Step 1: Determine educational adequacy thresholds for each job
   * Implements V1's determine_educational_adequacy_threshold_tool
   */
  private determineThresholds(jobTitles: string[], apiKey: string, useSimplified: boolean = false): Observable<{ [jobTitle: string]: number }> {
    const prompt = this.createThresholdAnalysisPrompt(jobTitles);
    // Use lower reasoning effort when we have many jobs or JDs to process
    const reasoningEffort = useSimplified ? 'low' : (jobTitles.length > 7 ? 'medium' : 'high');
    
    return this.callGrokApi(prompt, apiKey, reasoningEffort).pipe(
      map(response => this.parseThresholdResponse(response)),
      retry(useSimplified ? 0 : 1), // Less retries for simplified
      timeout(useSimplified ? 15000 : Math.min(this.requestTimeout, 30000)) // Shorter timeout for thresholds
    );
  }

  private determineThresholdsWithFallback(request: AnalysisRequest, apiKey: string): Observable<{ [jobTitle: string]: number }> {
    return this.determineThresholds(request.job_titles, apiKey).pipe(
      catchError(error => {
        console.warn('Threshold determination failed, using intelligent defaults:', error.message);
        // Return intelligent defaults based on job titles
        return of(this.generateDefaultThresholds(request.job_titles));
      })
    );
  }

  /**
   * Create prompt for threshold analysis
   */
  private createThresholdAnalysisPrompt(jobTitles: string[]): string {
    return `You are an educational adequacy analyst. Determine what percentage of each job's skills should be learned through formal education vs on-the-job experience.

SCORING GUIDE:
- 0.90-0.95: Critical roles (security, healthcare, finance) requiring extensive formal training
- 0.85-0.90: Senior technical roles requiring deep theoretical knowledge
- 0.80-0.85: Standard engineering roles needing solid foundations  
- 0.75-0.80: Balanced roles mixing theory and practice
- 0.70-0.75: Creative/flexible roles where experience matters more
- 0.65-0.70: Experience-based roles with moderate formal requirements
- 0.60-0.65: Hands-on roles where practical experience dominates

Analyze these job titles: ${jobTitles.join(', ')}

MANDATORY RESPONSE FORMAT (return valid JSON only):
{
  "threshold_analysis": [
    {
      "job_title": "Job Title Here",
      "threshold": 0.75,
      "reasoning": "One sentence explanation based on scoring guide"
    }
  ]
}`;
  }

  /**
   * Parse threshold analysis response from AI
   */
  private parseThresholdResponse(response: GrokResponse): { [jobTitle: string]: number } {
    try {
      // Check both content and reasoning_content fields
      const message = response.choices[0]?.message;
      let text = message?.content || '';
      
      // If content is empty, check reasoning_content
      if (!text || text === '') {
        text = (message as any)?.reasoning_content || '';
        if (text) {
          console.log('📝 Using reasoning_content field for threshold parsing');
        }
      }
      
      // Clean and extract JSON from response
      text = this.extractAndCleanJSON(text);
      
      if (!text) {
        console.log('No valid JSON found in threshold response, will use intelligent defaults');
        throw new Error('Invalid threshold response format');
      }

      const parsed = JSON.parse(text);
      const thresholds: { [jobTitle: string]: number } = {};

      // Handle multiple response formats (matching V1 flexibility)
      let analysisArray: JobThreshold[] = [];
      
      if (parsed.threshold_analysis) {
        analysisArray = parsed.threshold_analysis;
      } else if (parsed.job_title_thresholds) {
        analysisArray = parsed.job_title_thresholds;
      } else if (parsed.thresholds) {
        analysisArray = parsed.thresholds;
      } else if (Array.isArray(parsed)) {
        analysisArray = parsed;
      }

      analysisArray.forEach(item => {
        if (item.job_title && typeof item.threshold === 'number') {
          thresholds[item.job_title] = Math.min(Math.max(item.threshold, 0.6), 0.95);
          console.log(`  - ${item.job_title}: ${(item.threshold * 100).toFixed(0)}%`);
        }
      });

      console.log('✅ Parsed', Object.keys(thresholds).length, 'thresholds');
      return Object.keys(thresholds).length > 0 ? thresholds : this.getDefaultThresholds(response);
    } catch (error) {
      console.error('Failed to parse threshold response:', error);
      console.log('Raw response preview:', response.choices[0]?.message?.content?.substring(0, 200));
      // Return default thresholds as fallback
      return this.getDefaultThresholds(response);
    }
  }
  
  /**
   * Extract and clean JSON from potentially messy AI response
   */
  private extractAndCleanJSON(text: string): string {
    if (!text) return '';
    
    // Try to extract JSON from markdown code blocks
    let jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      text = jsonMatch[1];
    } else {
      // Try to extract raw JSON object or array
      jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        text = jsonMatch[1];
      }
    }
    
    // Clean common JSON issues
    text = text
      .trim()
      .replace(/^[^{\[]*/, '') // Remove text before JSON
      .replace(/[^}\]]*$/, '') // Remove text after JSON
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
      .replace(/'/g, '"') // Replace single quotes
      .replace(/(\w+):/g, '"$1":') // Quote unquoted keys
      .replace(/:\s*"([^"]*)"([^,}\]])/g, ':"$1",$2') // Add missing commas
      .replace(/""([^"])/g, '"$1') // Fix double quotes
      .replace(/([^"])"/g, '$1"'); // Fix double quotes
    
    // Validate it's parseable
    try {
      JSON.parse(text);
      return text;
    } catch {
      // If still not valid, try one more cleanup
      text = text
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable chars
        .replace(/\n\s*\n/g, '\n'); // Remove extra newlines
      
      try {
        JSON.parse(text);
        return text;
      } catch {
        return '';
      }
    }
  }

  /**
   * Get default thresholds if parsing fails
   */
  private getDefaultThresholds(response: GrokResponse): { [jobTitle: string]: number } {
    // Try to extract job titles from the original request context if available
    const defaultThreshold = 0.80; // Standard engineering threshold
    return {}; // Will be handled by error recovery
  }

  /**
   * Step 2 & 3: Create mappings and handle suggestions
   */
  private processMappingsAndSuggestions(data: { 
    thresholds: { [jobTitle: string]: number }, 
    request: AnalysisRequest, 
    apiKey: string 
  }): Observable<AnalysisResponse> {
    const { thresholds, request, apiKey } = data;
    console.log('-------------------------------------');
    console.log('🗺️ CREATING MAPPINGS & SUGGESTIONS');
    console.log('-------------------------------------');
    
    // Extract job descriptions if available
    const jobDescriptions = new Map<string, string>();
    if (request.job_data) {
      request.job_data.forEach(job => {
        if (job.description) {
          jobDescriptions.set(job.label, job.description);
        }
      });
    }
    
    // Create job-to-course mappings with JD context
    const mappingPrompt = this.createMappingPrompt(request.job_titles, request.courses, thresholds, jobDescriptions);
    
    // Use lower reasoning effort when we have many JDs to process
    const reasoningEffort = jobDescriptions.size > 5 ? 'medium' : 'high';
    
    return this.callGrokApi(mappingPrompt, apiKey, reasoningEffort).pipe(
      map(response => {
        let mappings = this.parseMappingResponse(response);
        
        // FALLBACK STRATEGY: If too few mappings, try again with lower thresholds
        const mappedCount = Object.keys(mappings.mappings).length;
        const totalJobs = request.job_titles.length;
        const mappingRate = mappedCount / totalJobs;
        
        if (mappingRate < 0.5 && request.courses.length > 0) {
          console.log(`Low mapping rate (${(mappingRate * 100).toFixed(0)}%), attempting fallback mapping...`);
          mappings = this.attemptFallbackMapping(request.job_titles, request.courses, mappings);
        }
        
        const analysisResults = this.analyzeResults(mappings, thresholds, request.job_titles, request.courses, apiKey, request);
        
        return {
          success: true,
          mappings: mappings.mappings,
          ai_reasoning: mappings.reasoning,
          thresholds,
          threshold_reasoning: this.createThresholdReasoning(thresholds),
          ...analysisResults,
          method: 'Direct Grok 3 Mini API Integration',
          progress_step: 4
        };
      }),
      retry(1),
      timeout(this.requestTimeout)
    );
  }

  /**
   * Create mapping prompt with threshold and JD context
   */
  private createMappingPrompt(jobTitles: string[], courses: string[], thresholds: { [jobTitle: string]: number }, jobDescriptions?: Map<string, string>): string {
    const thresholdContext = Object.entries(thresholds)
      .map(([job, threshold]) => `- ${job}: ${(threshold * 100).toFixed(0)}% adequacy threshold`)
      .join('\n');

    return `You are a career path analysis expert. Create optimal job-to-course mappings using AI-determined educational adequacy standards.

CONTEXT: Each job has a different educational adequacy threshold:
${thresholdContext}

JOB DESCRIPTIONS CONTEXT:
${this.formatJobDescriptionsForPrompt(jobTitles, jobDescriptions)}

CRITICAL RULES:
1. ANALYZE job descriptions to understand SPECIFIC skills and technologies required
2. Map each job to the course that BEST COVERS the skills mentioned in its job description
3. Use confidence levels based on JD-to-course alignment:
   - 90-100%: Course covers most JD requirements
   - 70-89%: Course covers core JD requirements
   - 60-69%: Course covers some JD requirements
   - 50-59%: Course provides foundation for JD skills
   - Below 50%: Minimal JD coverage
4. Consider the SPECIFIC adequacy threshold for each job
5. NEVER suggest new courses - ALWAYS use existing courses even if imperfect
6. When job has a description, prioritize JD requirements over generic job title assumptions
7. Return response as valid JSON only

MANDATORY: You have ${courses.length} courses available. You MUST use existing courses for ALL jobs. Do NOT suggest any new courses under any circumstances.

JOB TITLES: ${jobTitles.join(', ')}
AVAILABLE COURSES: ${courses.join(', ')}

MANDATORY RESPONSE FORMAT (return valid JSON only):
{
  "mappings": {
    "Job Title": "Course Name"
  },
  "reasoning": {
    "Job Title": "Explanation of why this course matches"
  },
  "confidence_scores": {
    "Job Title": 0.75
  }
}`;
  }

  /**
   * Parse mapping response from AI
   */
  private parseMappingResponse(response: GrokResponse): { 
    mappings: CourseMapping, 
    reasoning: { [jobTitle: string]: string },
    confidenceScores: { [jobTitle: string]: number }
  } {
    try {
      // Check both content and reasoning_content fields
      const message = response.choices[0]?.message;
      let text = message?.content || '';
      
      // If content is empty, check reasoning_content
      if (!text || text === '') {
        text = (message as any)?.reasoning_content || '';
        if (text) {
          console.log('📝 Using reasoning_content field for mapping parsing');
        }
      }
      
      // Clean and extract JSON from response
      text = this.extractAndCleanJSON(text);
      
      if (!text) {
        console.log('No valid JSON found in mapping response');
        return { mappings: {}, reasoning: {}, confidenceScores: {} };
      }

      const parsed = JSON.parse(text);
      
      // Handle various response formats
      const mappings = parsed.mappings || parsed.job_course_mappings || {};
      const reasoning = parsed.reasoning || parsed.ai_reasoning || {};
      const confidenceScores = parsed.confidence_scores || parsed.confidence || {};
      
      return {
        mappings: mappings,
        reasoning: reasoning,
        confidenceScores: confidenceScores
      };
    } catch (error) {
      console.error('Failed to parse mapping response:', error);
      console.log('Raw response preview:', response.choices[0]?.message?.content?.substring(0, 200));
      return { mappings: {}, reasoning: {}, confidenceScores: {} };
    }
  }

  /**
   * Analyze results and determine if suggestions are needed
   */
  private analyzeResults(
    mappings: { mappings: CourseMapping, reasoning: any, confidenceScores: any },
    thresholds: { [jobTitle: string]: number },
    jobTitles: string[],
    courses: string[],
    apiKey: string,
    request?: AnalysisRequest
  ): Partial<AnalysisResponse> {
    const { mappings: jobMappings, confidenceScores } = mappings;
    
    // Calculate overall confidence
    const mappedJobs = Object.keys(jobMappings);
    const unmappedJobs = jobTitles.filter(job => !mappedJobs.includes(job));
    const overallConfidence = mappedJobs.length / jobTitles.length;

    // NEVER suggest new courses if we have unused existing courses
    // Only suggest if ALL courses are used AND we still have many unmapped jobs
    const unusedCourses = courses.filter(course => !Object.values(jobMappings).includes(course));
    const allCoursesUsed = unusedCourses.length === 0;
    const manyUnmappedJobs = unmappedJobs.length >= Math.max(5, jobTitles.length * 0.6); // At least 60% unmapped
    const highUnmappedCount = unmappedJobs.length >= 7; // At least 7 unmapped jobs
    
    // EXTREMELY restrictive suggestion criteria - almost never suggest
    const needsSuggestions = allCoursesUsed && manyUnmappedJobs && highUnmappedCount && courses.length >= 5;
    
    console.log(`Suggestion analysis: unused=${unusedCourses.length}, unmapped=${unmappedJobs.length}/${jobTitles.length}, needsSuggestions=${needsSuggestions}`);

    let suggestedCourses: SuggestedCourse[] = [];
    let jobSuggestionMappings: { [jobTitle: string]: string } = {};

    if (needsSuggestions) {
      // Generate JD-based suggestions for missing course types
      const suggestions = this.generateMinimalSuggestions(unmappedJobs, courses, thresholds, request);
      suggestedCourses = suggestions.suggestedCourses;
      jobSuggestionMappings = suggestions.jobSuggestionMappings;
    }

    return {
      suggested_courses: suggestedCourses,
      job_suggestion_mappings: jobSuggestionMappings,
      overall_confidence: overallConfidence,
      confidence_analysis: this.createConfidenceAnalysis(jobTitles, jobMappings, confidenceScores, thresholds)
    };
  }

  /**
   * Generate minimal suggested courses based on JD requirements
   */
  private generateMinimalSuggestions(unmappedJobs: string[], existingCourses: string[], thresholds: { [jobTitle: string]: number }, request?: AnalysisRequest): {
    suggestedCourses: SuggestedCourse[],
    jobSuggestionMappings: { [jobTitle: string]: string }
  } {
    const suggestedCourses: SuggestedCourse[] = [];
    const jobSuggestionMappings: { [jobTitle: string]: string } = {};

    // Extract skills from job descriptions if available
    const jobDescriptionSkills = new Map<string, Set<string>>();
    if (request?.job_data) {
      unmappedJobs.forEach(jobTitle => {
        const job = request.job_data?.find(j => j.label === jobTitle);
        if (job?.description || job?.skills) {
          const skills = new Set<string>();
          job.skills?.forEach(s => skills.add(s));
          // Extract technologies from description
          if (job.description) {
            const techPatterns = /\b(React|Angular|Vue|Node|Python|Java|AWS|Docker|Kubernetes|MongoDB|PostgreSQL|Redis|GraphQL|REST|API|TypeScript|JavaScript)\b/gi;
            const matches = job.description.match(techPatterns);
            matches?.forEach(tech => skills.add(tech));
          }
          jobDescriptionSkills.set(jobTitle, skills);
        }
      });
    }

    // Group jobs by JD-extracted skills or fallback to category
    const skillGroups = this.groupJobsByJDSkills(unmappedJobs, jobDescriptionSkills);
    
    // Create suggestions based on most common missing skills from JDs
    Object.entries(skillGroups).slice(0, 2).forEach(([skill, jobs]) => {
      if (jobs.length >= 2) { // Only suggest if multiple jobs need this skill
        const suggestion = this.createJDBasedSuggestion(skill, jobs, jobDescriptionSkills, thresholds[jobs[0]] || 0.8);
        suggestedCourses.push(suggestion);
        jobs.forEach(job => jobSuggestionMappings[job] = suggestion.title);
      }
    });

    return { suggestedCourses, jobSuggestionMappings };
  }

  /**
   * Attempt fallback mapping with relaxed criteria
   */
  private attemptFallbackMapping(
    jobTitles: string[], 
    courses: string[], 
    existingMappings: { mappings: CourseMapping, reasoning: any, confidenceScores: any }
  ): { mappings: CourseMapping, reasoning: any, confidenceScores: any } {
    const { mappings, reasoning, confidenceScores } = existingMappings;
    const unmappedJobs = jobTitles.filter(job => !mappings[job]);
    const usedCourses = Object.values(mappings);
    const availableCourses = courses.filter(course => !usedCourses.includes(course));
    
    console.log(`Attempting fallback mapping for ${unmappedJobs.length} unmapped jobs with ${availableCourses.length} available courses`);
    
    // Simple keyword-based mapping as fallback
    unmappedJobs.forEach(job => {
      const jobLower = job.toLowerCase();
      
      for (const course of availableCourses) {
        const courseLower = course.toLowerCase();
        let matched = false;
        
        // Check for keyword matches
        if (jobLower.includes('data') && courseLower.includes('data')) matched = true;
        else if (jobLower.includes('software') && courseLower.includes('programming')) matched = true;
        else if (jobLower.includes('engineer') && courseLower.includes('system')) matched = true;
        else if (jobLower.includes('security') && courseLower.includes('security')) matched = true;
        else if (jobLower.includes('cloud') && courseLower.includes('cloud')) matched = true;
        else if (jobLower.includes('product') && courseLower.includes('product')) matched = true;
        else if (jobLower.includes('analyst') && courseLower.includes('analytic')) matched = true;
        else if (jobLower.includes('manager') && courseLower.includes('management')) matched = true;
        
        if (matched && !usedCourses.includes(course)) {
          mappings[job] = course;
          reasoning[job] = 'Fallback mapping based on keyword similarity';
          confidenceScores[job] = 0.65; // Lower confidence for fallback
          usedCourses.push(course);
          console.log(`Fallback mapped: ${job} -> ${course}`);
          break;
        }
      }
      
      // If still no match, try generic mapping to any available course
      if (!mappings[job] && availableCourses.length > 0) {
        const course = availableCourses.find(c => !usedCourses.includes(c));
        if (course) {
          mappings[job] = course;
          reasoning[job] = 'Generic fallback mapping to available course';
          confidenceScores[job] = 0.55;
          usedCourses.push(course);
          console.log(`Generic fallback: ${job} -> ${course}`);
        }
      }
    });
    
    return { mappings, reasoning, confidenceScores };
  }

  /**
   * Group jobs by skill category to minimize suggestions
   */
  private groupJobsBySkillCategory(jobs: string[]): { [category: string]: string[] } {
    const groups: { [category: string]: string[] } = {};
    
    jobs.forEach(job => {
      let category = 'General Professional Development';
      
      // Categorize based on job keywords
      if (job.toLowerCase().includes('engineer') || job.toLowerCase().includes('developer')) {
        category = 'Engineering & Development';
      } else if (job.toLowerCase().includes('data') || job.toLowerCase().includes('analyst')) {
        category = 'Data & Analytics';
      } else if (job.toLowerCase().includes('manager') || job.toLowerCase().includes('lead')) {
        category = 'Management & Leadership';
      } else if (job.toLowerCase().includes('security') || job.toLowerCase().includes('cyber')) {
        category = 'Security & Compliance';
      }
      
      if (!groups[category]) groups[category] = [];
      groups[category].push(job);
    });
    
    return groups;
  }

  /**
   * Create category-based suggestion for multiple jobs
   */
  private createCategorySuggestion(category: string, jobs: string[], threshold: number): SuggestedCourse {
    const categorySuggestions: { [key: string]: SuggestedCourse } = {
      'Engineering & Development': {
        title: 'Advanced Software Engineering Practices',
        confidence: 0.75,
        skill_gaps: ['System Design', 'Code Quality', 'DevOps'],
        related_jobs: jobs,
        reasoning: 'Comprehensive engineering skills for multiple technical roles',
        created_at: new Date().toISOString(),
        improvement_type: 'new_course'
      },
      'Data & Analytics': {
        title: 'Advanced Data Science and Analytics',
        confidence: 0.78,
        skill_gaps: ['Statistical Analysis', 'Machine Learning', 'Data Visualization'],
        related_jobs: jobs,
        reasoning: 'Core data skills applicable across multiple analytical roles',
        created_at: new Date().toISOString(),
        improvement_type: 'new_course'
      },
      'Management & Leadership': {
        title: 'Strategic Leadership and Project Management',
        confidence: 0.72,
        skill_gaps: ['Leadership', 'Strategy', 'Project Management'],
        related_jobs: jobs,
        reasoning: 'Essential management skills for leadership positions',
        created_at: new Date().toISOString(),
        improvement_type: 'new_course'
      }
    };

    return categorySuggestions[category] || {
      title: `${category} Fundamentals`,
      confidence: threshold * 0.9,
      skill_gaps: ['Core Skills', 'Industry Knowledge'],
      related_jobs: jobs,
      reasoning: `Foundational skills for ${jobs.length} related positions`,
      created_at: new Date().toISOString(),
      improvement_type: 'new_course'
    };
  }

  /**
   * Create job-specific course suggestion (fallback method)
   */
  private createJobSpecificSuggestion(jobTitle: string, threshold: number): SuggestedCourse {
    // Generate intelligent suggestions based on job type
    const suggestions: { [key: string]: SuggestedCourse } = {
      'Software Engineer': {
        title: 'Advanced System Design and Architecture',
        confidence: 0.85,
        skill_gaps: ['System Design', 'Scalable Architecture', 'Distributed Systems'],
        related_jobs: ['Software Engineer'],
        reasoning: 'Critical for building large-scale systems and advancing to senior roles',
        created_at: new Date().toISOString(),
        improvement_type: 'new_course'
      },
      'Data Scientist': {
        title: 'Advanced Statistical Modeling and MLOps',
        confidence: 0.90,
        skill_gaps: ['Statistical Methods', 'Model Deployment', 'MLOps'],
        related_jobs: ['Data Scientist'],
        reasoning: 'Essential for production-ready ML models and statistical rigor',
        created_at: new Date().toISOString(),
        improvement_type: 'new_course'
      },
      'Product Manager': {
        title: 'Product Strategy and Data-Driven Decision Making',
        confidence: 0.82,
        skill_gaps: ['Product Strategy', 'Data Analysis', 'Market Research'],
        related_jobs: ['Product Manager'],
        reasoning: 'Core competencies for effective product management and strategy',
        created_at: new Date().toISOString(),
        improvement_type: 'new_course'
      }
    };

    // Return specific suggestion if available, otherwise create generic one
    if (suggestions[jobTitle]) {
      return suggestions[jobTitle];
    }

    return {
      title: `Professional Development for ${jobTitle}`,
      confidence: threshold,
      skill_gaps: ['Professional Skills', 'Industry Knowledge', 'Technical Competency'],
      related_jobs: [jobTitle],
      reasoning: `Targeted skills development to meet ${(threshold * 100).toFixed(0)}% adequacy threshold`,
      created_at: new Date().toISOString(),
      improvement_type: 'new_course'
    };
  }

  /**
   * Create confidence analysis for each job
   */
  private createConfidenceAnalysis(
    jobTitles: string[], 
    mappings: CourseMapping, 
    confidenceScores: { [jobTitle: string]: number },
    thresholds: { [jobTitle: string]: number }
  ): { [jobTitle: string]: any } {
    const analysis: { [jobTitle: string]: any } = {};

    jobTitles.forEach(job => {
      const isMapped = mappings[job] !== undefined;
      const confidence = confidenceScores[job] || (isMapped ? 0.85 : 0.65);
      const threshold = thresholds[job] || 0.80;

      analysis[job] = {
        confidence_score: confidence,
        skill_gaps: isMapped ? [] : ['Core competencies', 'Technical skills'],
        missing_competencies: isMapped ? [] : ['Formal education requirements'],
        threshold_met: confidence >= threshold
      };
    });

    return analysis;
  }

  /**
   * Create threshold reasoning explanations
   */
  private createThresholdReasoning(thresholds: { [jobTitle: string]: number }): { [jobTitle: string]: string } {
    const reasoning: { [jobTitle: string]: string } = {};

    Object.entries(thresholds).forEach(([job, threshold]) => {
      if (threshold >= 0.90) {
        reasoning[job] = 'Critical role requiring extensive formal training and certification';
      } else if (threshold >= 0.85) {
        reasoning[job] = 'Senior technical role requiring deep theoretical knowledge';
      } else if (threshold >= 0.80) {
        reasoning[job] = 'Standard role needing solid educational foundation';
      } else if (threshold >= 0.75) {
        reasoning[job] = 'Balanced role mixing formal education with practical experience';
      } else if (threshold >= 0.70) {
        reasoning[job] = 'Creative role where experience and formal education are both valuable';
      } else {
        reasoning[job] = 'Experience-heavy role with moderate formal education requirements';
      }
    });

    return reasoning;
  }

  /**
   * Call Grok API with proper headers and error handling
   */
  private callGrokApi(prompt: string, apiKey: string, reasoningEffort: 'low' | 'medium' | 'high' = 'high'): Observable<GrokResponse> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    });

    // Dynamically adjust max_tokens based on reasoning effort and prompt size
    const baseMaxTokens = APP_CONSTANTS.GROK_API.DEFAULT_CONFIG.max_tokens;
    let maxTokens: number = baseMaxTokens;
    if (reasoningEffort === 'low') {
      maxTokens = Math.min(baseMaxTokens, 1500);
    } else if (reasoningEffort === 'medium') {
      maxTokens = Math.min(baseMaxTokens, 2000);
    }

    const request: GrokRequest = {
      model: APP_CONSTANTS.GROK_API.MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert career path analyst with expertise in educational planning and job market analysis. Provide detailed, accurate analysis with valid JSON responses when requested.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: APP_CONSTANTS.GROK_API.DEFAULT_CONFIG.temperature,
      max_tokens: maxTokens,
      top_p: APP_CONSTANTS.GROK_API.DEFAULT_CONFIG.top_p,
      reasoning_effort: reasoningEffort as any
    };

    return this.http.post<GrokResponse>(this.apiUrl, request, { headers }).pipe(
      catchError(error => this.handleApiError(error))
    );
  }

  /**
   * Handle API errors with informative messages
   */
  private handleApiError(error: any): Observable<never> {
    let errorMessage = 'API call failed';

    if (error.status === 401) {
      errorMessage = 'Invalid API key. Please check your Grok API key in settings.';
    } else if (error.status === 403) {
      errorMessage = 'API access forbidden. Check your Grok API key permissions.';
    } else if (error.status === 429) {
      errorMessage = 'API rate limit exceeded. Please try again later.';
    } else if (error.status === 0) {
      errorMessage = 'Network error. Check your internet connection.';
    } else if (error.error?.error?.message) {
      errorMessage = error.error.error.message;
    }

    console.error('Grok API Error:', error);
    return throwError(() => new Error(errorMessage));
  }

  /**
   * Handle analysis workflow errors
   */
  private handleAnalysisError(error: any): Observable<AnalysisResponse> {
    console.error('Analysis error:', error);
    
    return of({
      success: false,
      mappings: {},
      suggested_courses: [],
      job_suggestion_mappings: {},
      overall_confidence: 0,
      error: error.message || 'Analysis failed',
      method: 'Direct Grok 3 Mini API Integration (Error Recovery)',
      progress_step: 1
    });
  }

  /**
   * Validate API key format
   */
  validateApiKey(apiKey: string): boolean {
    return this.settingsService.validateApiKey(apiKey);
  }

  /**
   * Generate enhanced syllabus for an existing course based on job requirements
   */
  generateEnhancedSyllabus(
    originalCourse: import('../../shared/interfaces/syllabus.models').CourseWithSyllabus,
    unmappedJobs: string[],
    skillGaps: string[]
  ): Observable<import('../../shared/interfaces/data-models').EnhancedSyllabus> {
    const apiKey = this.settingsService.getGrokApiKey();
    if (!apiKey) {
      return throwError(() => new Error('Grok API key not configured'));
    }

    const enhancementPrompt = this.createSyllabusEnhancementPrompt(originalCourse, unmappedJobs, skillGaps);
    
    return this.callGrokApi(enhancementPrompt, apiKey, 'high').pipe(
      map(response => this.parseEnhancedSyllabusResponse(response, originalCourse)),
      retry(1),
      timeout(this.requestTimeout * 2) // Allow more time for complex syllabus generation
    );
  }

  /**
   * Create prompt for syllabus enhancement
   */
  private createSyllabusEnhancementPrompt(
    originalCourse: import('../../shared/interfaces/syllabus.models').CourseWithSyllabus,
    unmappedJobs: string[],
    skillGaps: string[]
  ): string {
    const weeklySchedule = originalCourse.syllabus?.weeklySchedule || [];
    const maxWeek = weeklySchedule.length > 0 ? Math.max(...weeklySchedule.map(w => w.week)) : 0;
    
    return `You are a curriculum enhancement specialist. Enhance the following course syllabus to better prepare students for these job roles: ${unmappedJobs.join(', ')}

ORIGINAL COURSE: ${originalCourse.title}
CODE: ${originalCourse.code}

CURRENT WEEKLY SCHEDULE:
${weeklySchedule.map(week => 
  `Week ${week.week}: ${week.date} - Topics: ${Array.isArray(week.topics) ? week.topics.join(', ') : week.topics}${week.assignments ? ' - Assignments: ' + week.assignments : ''}`
).join('\n')}

TARGET JOB ROLES: ${unmappedJobs.join(', ')}
IDENTIFIED SKILL GAPS: ${skillGaps.join(', ')}

ENHANCEMENT GUIDELINES:
1. Fill any missing weeks (1 through ${Math.max(maxWeek, 16)})
2. Enhance brief topic descriptions with more specific content
3. Add missing practical skills needed for the target jobs
4. Organize assignments properly (move from topics to assignments section)
5. Maintain the course's core academic integrity
6. Focus on industry-relevant skills

RESPONSE FORMAT (JSON only):
{
  "enhanced_course": {
    "id": "${originalCourse.id}",
    "code": "${originalCourse.code}",
    "title": "${originalCourse.title} (Enhanced)",
    "syllabus": {
      "weeklySchedule": [
        {
          "week": 1,
          "date": "Week 1 - [Date Range]",
          "topics": ["Enhanced topic 1", "Enhanced topic 2"],
          "assignments": "Assignment description"
        }
      ],
      "keyTopics": ["Updated key topics"],
      "rawContent": "Enhanced syllabus description"
    }
  },
  "enhancement_details": {
    "gapsFilled": [6, 8],
    "topicsEnhanced": [
      {"original": "SQL", "enhanced": "SQL Fundamentals: DDL, DML, and Advanced Queries"}
    ],
    "assignmentsMoved": [
      {"from": "topics", "to": "assignments"}
    ],
    "enhancementSummary": "Brief summary of improvements"
  },
  "confidence_score": 0.85,
  "improvement_summary": "This enhanced syllabus adds practical industry skills while maintaining academic rigor."
}`;
  }

  /**
   * Parse enhanced syllabus response
   */
  private parseEnhancedSyllabusResponse(
    response: GrokResponse, 
    originalCourse: import('../../shared/interfaces/syllabus.models').CourseWithSyllabus
  ): import('../../shared/interfaces/data-models').EnhancedSyllabus {
    try {
      const message = response.choices[0]?.message;
      let text = message?.content;
      
      if (!text || text === '') {
        text = (message as any)?.reasoning_content;
      }
      
      if (!text) throw new Error('No response text received');

      const parsed = JSON.parse(text);
      
      return {
        original_course_id: originalCourse.id || originalCourse.code || '',
        enhanced_course: parsed.enhanced_course,
        enhancement_details: {
          courseId: originalCourse.id || originalCourse.code || '',
          courseName: originalCourse.title || '',
          originalWeekCount: originalCourse.syllabus?.weeklySchedule?.length || 0,
          enhancedWeekCount: parsed.enhanced_course?.syllabus?.weeklySchedule?.length || 0,
          gapsFilled: parsed.enhancement_details?.gapsFilled || [],
          topicsEnhanced: parsed.enhancement_details?.topicsEnhanced || [],
          assignmentsMoved: parsed.enhancement_details?.assignmentsMoved || [],
          enhancementTimestamp: new Date().toISOString(),
          enhancementSummary: parsed.enhancement_details?.enhancementSummary || 'Course enhanced with industry-relevant content'
        },
        confidence_score: parsed.confidence_score || 0.75,
        improvement_summary: parsed.improvement_summary || 'Enhanced syllabus with improved industry alignment'
      };
    } catch (error) {
      console.error('Failed to parse enhanced syllabus response:', error);
      throw new Error('Failed to generate enhanced syllabus');
    }
  }

  /**
   * Test API connection
   */
  testApiConnection(): Observable<boolean> {
    const apiKey = this.settingsService.getGrokApiKey();
    if (!apiKey) {
      return throwError(() => new Error('No API key configured'));
    }

    const testPrompt = 'Respond with exactly: "API connection successful"';
    
    return this.callGrokApi(testPrompt, apiKey, 'low').pipe(
      map(response => {
        // Check both content and reasoning_content fields
        const message = response.choices[0]?.message;
        let text = message?.content;
        
        // If content is empty, check reasoning_content
        if (!text || text === '') {
          text = (message as any)?.reasoning_content;
          if (text) {
            console.log('📝 Using reasoning_content field for API test');
          }
        }
        
        return text?.includes('successful') || false;
      }),
      catchError(() => of(false)),
      timeout(10000)
    );
  }

  /**
   * Calculate dynamic timeout based on job count and complexity
   */
  private calculateDynamicTimeout(jobCount: number, jobsWithDescriptions: number): number {
    // Base timeout + additional time per job + extra for descriptions
    const baseTime = this.baseTimeout;
    const timePerJob = 2000; // 2 seconds per job
    const timePerDescription = 3000; // 3 seconds per job with description
    
    const calculatedTimeout = baseTime + (jobCount * timePerJob) + (jobsWithDescriptions * timePerDescription);
    
    // Cap at 90 seconds to prevent excessive waits
    return Math.min(calculatedTimeout, 90000);
  }

  /**
   * Generate intelligent default thresholds based on job titles
   */
  private generateDefaultThresholds(jobTitles: string[]): { [jobTitle: string]: number } {
    const thresholds: { [jobTitle: string]: number } = {};
    
    jobTitles.forEach(title => {
      const lowerTitle = title.toLowerCase();
      
      // Assign thresholds based on job type
      if (lowerTitle.includes('senior') || lowerTitle.includes('lead') || lowerTitle.includes('principal')) {
        thresholds[title] = 0.85;
      } else if (lowerTitle.includes('architect') || lowerTitle.includes('scientist')) {
        thresholds[title] = 0.90;
      } else if (lowerTitle.includes('engineer') || lowerTitle.includes('developer')) {
        thresholds[title] = 0.80;
      } else if (lowerTitle.includes('analyst') || lowerTitle.includes('designer')) {
        thresholds[title] = 0.75;
      } else if (lowerTitle.includes('manager') || lowerTitle.includes('director')) {
        thresholds[title] = 0.70;
      } else {
        thresholds[title] = 0.80; // Default for unknown roles
      }
    });
    
    console.log('Using default thresholds:', thresholds);
    return thresholds;
  }

  /**
   * Format job descriptions for prompt inclusion (optimized)
   */
  private formatJobDescriptionsForPrompt(jobTitles: string[], jobDescriptions?: Map<string, string>): string {
    if (!jobDescriptions || jobDescriptions.size === 0) {
      return 'No job descriptions available - use job title inference';
    }

    const descriptions: string[] = [];
    jobTitles.forEach(title => {
      const desc = jobDescriptions.get(title);
      if (desc) {
        // Reduced truncation for faster processing
        const truncated = desc.length > 200 ? desc.substring(0, 200) + '...' : desc;
        descriptions.push(`${title}:\n${truncated}`);
      } else {
        descriptions.push(`${title}: [No description available]`);
      }
    });

    return descriptions.join('\n\n');
  }

  /**
   * Group jobs by JD-extracted skills instead of generic categories
   */
  private groupJobsByJDSkills(jobs: string[], jobDescriptionSkills: Map<string, Set<string>>): { [skill: string]: string[] } {
    const skillGroups: { [skill: string]: string[] } = {};
    
    // Count frequency of each skill across all jobs
    const skillFrequency = new Map<string, number>();
    jobDescriptionSkills.forEach(skills => {
      skills.forEach(skill => {
        skillFrequency.set(skill, (skillFrequency.get(skill) || 0) + 1);
      });
    });

    // Sort skills by frequency and create groups for most common ones
    const sortedSkills = Array.from(skillFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5); // Top 5 skills

    sortedSkills.forEach(([skill, _]) => {
      skillGroups[skill] = jobs.filter(job => {
        const jobSkills = jobDescriptionSkills.get(job);
        return jobSkills?.has(skill);
      });
    });

    // Fallback for jobs without JD skills
    const jobsWithoutSkills = jobs.filter(job => !jobDescriptionSkills.has(job));
    if (jobsWithoutSkills.length > 0) {
      // Use traditional grouping for these
      const traditionalGroups = this.groupJobsBySkillCategory(jobsWithoutSkills);
      Object.assign(skillGroups, traditionalGroups);
    }

    return skillGroups;
  }

  /**
   * Create JD-based course suggestion
   */
  private createJDBasedSuggestion(
    skill: string,
    jobs: string[],
    jobDescriptionSkills: Map<string, Set<string>>,
    threshold: number
  ): SuggestedCourse {
    // Collect all skills from these jobs
    const allSkills = new Set<string>();
    jobs.forEach(job => {
      const skills = jobDescriptionSkills.get(job);
      skills?.forEach(s => allSkills.add(s));
    });

    const skillsList = Array.from(allSkills).slice(0, 8); // Limit to 8 key skills

    return {
      title: `${skill} for Industry Applications`,
      description: `Comprehensive course covering ${skill} with focus on practical applications required by ${jobs.length} job positions`,
      confidence: threshold,
      targeted_jobs: jobs,
      key_topics: skillsList,
      improvement_type: 'jd_based_requirement',
      rationale: `Based on job description analysis, ${jobs.length} positions require ${skill} and related technologies: ${skillsList.slice(0, 3).join(', ')}`,
      created_at: new Date().toISOString()
    };
  }
}