import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, combineLatest, forkJoin, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { 
  CourseWithSyllabus, 
  GapAnalysisResult, 
  CurriculumGapReport,
  SyllabusComparisonResult 
} from '../../shared/interfaces/syllabus.models';
import { JobTitle } from '../../shared/interfaces/data-models';
import { JobDescriptionAnalysisService, JobSkillExtraction, SyllabusGapAnalysis } from './job-description-analysis.service';

@Injectable({
  providedIn: 'root'
})
export class GapAnalysisService {
  private gapAnalysisResults$ = new BehaviorSubject<GapAnalysisResult[]>([]);
  private curriculumReport$ = new BehaviorSubject<CurriculumGapReport | null>(null);
  private jobSkillsCache = new Map<string, JobSkillExtraction>();
  
  // Fallback industry-required skills for when JD is not available
  private fallbackSkillsMap: Map<string, string[]> = new Map([
    ['Software Engineer', [
      'Python Programming', 'Java Programming', 'Data Structures', 
      'Algorithms', 'System Design', 'Database Management', 
      'Git', 'Testing', 'Cloud Computing', 'REST APIs'
    ]],
    ['Data Scientist', [
      'Python Programming', 'R Programming', 'Machine Learning', 
      'Statistics', 'Data Visualization', 'SQL', 'Big Data', 
      'Deep Learning', 'Data Mining', 'Analytics'
    ]],
    ['Cloud Architect', [
      'Cloud Computing', 'AWS', 'Azure', 'Kubernetes', 'Docker',
      'Microservices', 'DevOps', 'Infrastructure as Code', 
      'Security', 'Networking'
    ]],
    ['Project Manager', [
      'Project Management', 'Agile Methodology', 'Scrum', 
      'Requirements Analysis', 'Risk Management', 'Communication',
      'Budgeting', 'Team Leadership', 'Stakeholder Management'
    ]],
    ['Database Administrator', [
      'Database Management', 'SQL', 'NoSQL', 'Data Warehousing',
      'Performance Tuning', 'Backup and Recovery', 'Security',
      'Data Modeling', 'ETL Process', 'MongoDB'
    ]]
  ]);

  constructor(
    private jobDescriptionAnalysis: JobDescriptionAnalysisService
  ) {}

  /**
   * Analyze gaps for a single course against job requirements using JD when available
   */
  analyzeCourseGaps(
    course: CourseWithSyllabus, 
    targetJobs: JobTitle[]
  ): Observable<GapAnalysisResult> {
    const courseTopics = course.syllabus?.keyTopics || [];
    
    // If jobs have descriptions, use JD-based analysis
    const jobsWithDescriptions = targetJobs.filter(j => j.description);
    
    if (jobsWithDescriptions.length > 0) {
      // Use JD-based analysis for jobs with descriptions
      return this.analyzeWithJobDescriptions(course, targetJobs, courseTopics);
    } else {
      // Fallback to traditional analysis
      return of(this.analyzeCourseGapsTraditional(course, targetJobs));
    }
  }

  /**
   * Traditional gap analysis (fallback when no JD available)
   */
  private analyzeCourseGapsTraditional(
    course: CourseWithSyllabus, 
    targetJobs: JobTitle[]
  ): GapAnalysisResult {
    const courseTopics = course.syllabus?.keyTopics || [];
    const requiredSkills = this.getRequiredSkillsForJobs(targetJobs);
    
    const coveredTopics = courseTopics.filter(topic => 
      requiredSkills.some(skill => 
        this.isTopicRelatedToSkill(topic, skill)
      )
    );
    
    const missingTopics = requiredSkills.filter(skill =>
      !courseTopics.some(topic => 
        this.isTopicRelatedToSkill(topic, skill)
      )
    );
    
    const coveragePercentage = requiredSkills.length > 0
      ? (coveredTopics.length / requiredSkills.length) * 100
      : 0;
    
    const recommendations = this.generateRecommendations(
      missingTopics, 
      course.category
    );
    
    return {
      courseId: course.id,
      courseTitle: course.title,
      coveredTopics,
      missingTopics,
      suggestedTopics: this.suggestAdditionalTopics(missingTopics, course.category),
      coveragePercentage,
      recommendations
    };
  }

  /**
   * JD-based gap analysis using actual job descriptions
   */
  private analyzeWithJobDescriptions(
    course: CourseWithSyllabus,
    targetJobs: JobTitle[],
    courseTopics: string[]
  ): Observable<GapAnalysisResult> {
    // Extract skills from all job descriptions
    const skillExtractions$ = targetJobs.map(job => 
      this.jobDescriptionAnalysis.extractSkillsFromJobDescription(job)
    );

    return forkJoin(skillExtractions$).pipe(
      switchMap(extractions => {
        // Cache extractions
        extractions.forEach(ext => {
          this.jobSkillsCache.set(ext.jobId, ext);
        });

        // Combine all extracted skills and technologies
        const allRequiredSkills = new Set<string>();
        const allTechnologies = new Set<string>();
        
        extractions.forEach(ext => {
          ext.extractedSkills.forEach(skill => allRequiredSkills.add(skill));
          ext.requiredTechnologies.forEach(tech => allTechnologies.add(tech));
        });

        const requiredSkillsArray = Array.from(allRequiredSkills);
        const requiredTechArray = Array.from(allTechnologies);

        // Analyze gaps with JD-extracted skills
        return this.jobDescriptionAnalysis.analyzeSyllabusGapsWithJobDescription(
          targetJobs[0], // Use first job as reference
          courseTopics,
          course.syllabus
        ).pipe(
          map(gapAnalysis => {
            // Calculate coverage based on JD requirements
            const coveredTopics = gapAnalysis.matchedTopics;
            const missingTopics = [...gapAnalysis.missingSkills, ...requiredTechArray.filter(
              tech => !coveredTopics.some(topic => 
                topic.toLowerCase().includes(tech.toLowerCase())
              )
            )];

            const coveragePercentage = gapAnalysis.alignmentScore * 100;

            // Generate JD-based recommendations
            const recommendations = this.generateJDBasedRecommendations(
              gapAnalysis,
              extractions,
              course.category
            );

            return {
              courseId: course.id,
              courseTitle: course.title,
              coveredTopics,
              missingTopics,
              suggestedTopics: gapAnalysis.suggestedTopics,
              coveragePercentage,
              recommendations,
              jdBasedAnalysis: true,
              syllabusEnhancements: gapAnalysis.syllabusEnhancements
            } as GapAnalysisResult;
          })
        );
      }),
      catchError(() => {
        // Fallback to traditional analysis on error
        return of(this.analyzeCourseGapsTraditional(course, targetJobs));
      })
    );
  }

  /**
   * Generate recommendations based on JD analysis
   */
  private generateJDBasedRecommendations(
    gapAnalysis: SyllabusGapAnalysis,
    skillExtractions: JobSkillExtraction[],
    courseCategory: string
  ): string[] {
    const recommendations: string[] = [];
    
    // High priority enhancements from JD
    const highPriorityEnhancements = gapAnalysis.syllabusEnhancements
      ?.filter(e => e.priority === 'high')
      .slice(0, 3);
    
    highPriorityEnhancements?.forEach(enhancement => {
      recommendations.push(
        `Add ${enhancement.suggestedAddition} (Required by: ${enhancement.sourceJobRequirement})`
      );
    });

    // Common technologies across multiple JDs
    const techFrequency = new Map<string, number>();
    skillExtractions.forEach(ext => {
      ext.requiredTechnologies.forEach(tech => {
        techFrequency.set(tech, (techFrequency.get(tech) || 0) + 1);
      });
    });

    const commonTechs = Array.from(techFrequency.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    commonTechs.forEach(([tech, count]) => {
      if (!recommendations.some(r => r.includes(tech))) {
        recommendations.push(
          `Include ${tech} - required by ${count} job postings`
        );
      }
    });

    return recommendations.slice(0, 5);
  }

  /**
   * Analyze gaps across entire curriculum
   */
  analyzeCurriculumGaps(
    courses: CourseWithSyllabus[],
    targetJobs: JobTitle[]
  ): CurriculumGapReport {
    const gapsByCategory = new Map<string, GapAnalysisResult[]>();
    const allGapResults: GapAnalysisResult[] = [];

    // Analyze each course synchronously (using traditional method for consistency)
    for (const course of courses) {
      const gapResult = this.analyzeCourseGapsTraditional(course, targetJobs);
      allGapResults.push(gapResult);

      const category = course.category || 'Uncategorized';
      if (!gapsByCategory.has(category)) {
        gapsByCategory.set(category, []);
      }
      gapsByCategory.get(category)!.push(gapResult);
    }
    
    // Calculate overall coverage
    const totalRequiredSkills = this.getRequiredSkillsForJobs(targetJobs).length;
    const allCoveredTopics = new Set<string>();
    
    allGapResults.forEach(result => {
      result.coveredTopics.forEach(topic => allCoveredTopics.add(topic));
    });
    
    const overallCoverage = totalRequiredSkills > 0
      ? (allCoveredTopics.size / totalRequiredSkills) * 100
      : 0;
    
    // Generate prioritized recommendations
    const prioritizedRecommendations = this.prioritizeRecommendations(allGapResults);
    
    const report: CurriculumGapReport = {
      timestamp: new Date(),
      analyzedCourses: courses.length,
      totalGaps: allGapResults.reduce((sum, r) => sum + r.missingTopics.length, 0),
      overallCoverage,
      gapsByCategory,
      prioritizedRecommendations
    };
    
    this.gapAnalysisResults$.next(allGapResults);
    this.curriculumReport$.next(report);
    
    return report;
  }

  /**
   * Compare syllabi of two courses
   */
  compareSyllabi(
    course1: CourseWithSyllabus,
    course2: CourseWithSyllabus
  ): SyllabusComparisonResult {
    const topics1 = new Set(course1.syllabus?.keyTopics || []);
    const topics2 = new Set(course2.syllabus?.keyTopics || []);
    
    const commonTopics = Array.from(topics1).filter(t => topics2.has(t));
    const uniqueToCourse1 = Array.from(topics1).filter(t => !topics2.has(t));
    const uniqueToCourse2 = Array.from(topics2).filter(t => !topics1.has(t));
    
    const totalTopics = new Set([...topics1, ...topics2]).size;
    const similarityScore = totalTopics > 0
      ? (commonTopics.length / totalTopics) * 100
      : 0;
    
    return {
      course1,
      course2,
      commonTopics,
      uniqueToCourse1,
      uniqueToCourse2,
      similarityScore
    };
  }

  /**
   * Get required skills for selected jobs
   */
  private getRequiredSkillsForJobs(jobs: JobTitle[]): string[] {
    const allSkills = new Set<string>();
    
    jobs.forEach(job => {
      // First check if we have JD-extracted skills in cache
      const cachedExtraction = this.jobSkillsCache.get(job.id);
      if (cachedExtraction) {
        cachedExtraction.extractedSkills.forEach(skill => allSkills.add(skill));
        cachedExtraction.requiredTechnologies.forEach(tech => allSkills.add(tech));
      } else if (job.skills && job.skills.length > 0) {
        // Use skills from job object if available
        job.skills.forEach(skill => allSkills.add(skill));
      } else {
        // Fallback to predefined skills map
        const jobSkills = this.fallbackSkillsMap.get(job.label) || [];
        jobSkills.forEach(skill => allSkills.add(skill));
      }
    });
    
    return Array.from(allSkills);
  }

  /**
   * Check if a topic relates to a required skill
   */
  private isTopicRelatedToSkill(topic: string, skill: string): boolean {
    const topicLower = topic.toLowerCase();
    const skillLower = skill.toLowerCase();
    
    // Direct match
    if (topicLower.includes(skillLower) || skillLower.includes(topicLower)) {
      return true;
    }
    
    // Synonym mapping
    const synonyms: { [key: string]: string[] } = {
      'database': ['sql', 'nosql', 'data management', 'mongodb'],
      'programming': ['coding', 'development', 'software'],
      'analytics': ['analysis', 'data science', 'business intelligence'],
      'cloud': ['aws', 'azure', 'gcp', 'cloud computing'],
      'project management': ['agile', 'scrum', 'pm', 'project planning']
    };
    
    for (const [key, values] of Object.entries(synonyms)) {
      if ((topicLower.includes(key) || skillLower.includes(key)) &&
          values.some(v => topicLower.includes(v) || skillLower.includes(v))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Generate recommendations based on gaps
   */
  private generateRecommendations(
    missingTopics: string[],
    category: string
  ): string[] {
    const recommendations: string[] = [];
    
    if (missingTopics.length === 0) {
      return ['Course content aligns well with industry requirements'];
    }
    
    // Group missing topics by area
    const topicAreas = {
      programming: missingTopics.filter(t => 
        t.toLowerCase().includes('programming') || 
        t.toLowerCase().includes('coding')
      ),
      database: missingTopics.filter(t => 
        t.toLowerCase().includes('database') || 
        t.toLowerCase().includes('sql')
      ),
      cloud: missingTopics.filter(t => 
        t.toLowerCase().includes('cloud') || 
        t.toLowerCase().includes('aws')
      ),
      management: missingTopics.filter(t => 
        t.toLowerCase().includes('management') || 
        t.toLowerCase().includes('agile')
      )
    };
    
    // Generate specific recommendations
    if (topicAreas.programming.length > 0) {
      recommendations.push(
        `Add programming modules covering: ${topicAreas.programming.slice(0, 3).join(', ')}`
      );
    }
    
    if (topicAreas.database.length > 0) {
      recommendations.push(
        `Enhance database content with: ${topicAreas.database.slice(0, 3).join(', ')}`
      );
    }
    
    if (topicAreas.cloud.length > 0) {
      recommendations.push(
        `Introduce cloud computing topics: ${topicAreas.cloud.slice(0, 3).join(', ')}`
      );
    }
    
    if (topicAreas.management.length > 0) {
      recommendations.push(
        `Include project management concepts: ${topicAreas.management.slice(0, 3).join(', ')}`
      );
    }
    
    return recommendations.slice(0, 5);
  }

  /**
   * Suggest additional topics based on gaps
   */
  private suggestAdditionalTopics(
    missingTopics: string[],
    category: string
  ): string[] {
    const suggestions: string[] = [];
    
    // Suggest complementary topics based on category
    if (category.includes('Database')) {
      suggestions.push('Data Warehousing', 'ETL Processes', 'Data Lake Architecture');
    } else if (category.includes('Programming')) {
      suggestions.push('Design Patterns', 'Code Review Practices', 'CI/CD Pipeline');
    } else if (category.includes('Systems')) {
      suggestions.push('Microservices Architecture', 'System Integration', 'API Design');
    }
    
    // Add trending topics
    const trendingTopics = [
      'AI/ML Integration',
      'Blockchain Fundamentals',
      'Cybersecurity Best Practices',
      'Edge Computing',
      'Quantum Computing Basics'
    ];
    
    // Filter to avoid duplicates
    const filteredSuggestions = [...suggestions, ...trendingTopics]
      .filter(topic => !missingTopics.includes(topic))
      .slice(0, 5);
    
    return filteredSuggestions;
  }

  /**
   * Prioritize recommendations across all courses
   */
  private prioritizeRecommendations(results: GapAnalysisResult[]): string[] {
    const recommendationCounts = new Map<string, number>();
    
    // Count frequency of each recommendation
    results.forEach(result => {
      result.recommendations.forEach(rec => {
        const count = recommendationCounts.get(rec) || 0;
        recommendationCounts.set(rec, count + 1);
      });
    });
    
    // Sort by frequency and return top recommendations
    return Array.from(recommendationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 10);
  }

  /**
   * Get observable for gap analysis results
   */
  getGapAnalysisResults(): Observable<GapAnalysisResult[]> {
    return this.gapAnalysisResults$.asObservable();
  }

  /**
   * Get observable for curriculum report
   */
  getCurriculumReport(): Observable<CurriculumGapReport | null> {
    return this.curriculumReport$.asObservable();
  }

  /**
   * Export gap analysis to CSV
   */
  exportToCSV(results: GapAnalysisResult[]): string {
    const headers = [
      'Course ID',
      'Course Title',
      'Coverage %',
      'Covered Topics',
      'Missing Topics',
      'Recommendations'
    ];
    
    const rows = results.map(result => [
      result.courseId,
      result.courseTitle,
      result.coveragePercentage.toFixed(1),
      result.coveredTopics.join('; '),
      result.missingTopics.join('; '),
      result.recommendations.join('; ')
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csvContent;
  }
}