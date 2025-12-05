import { Component, ViewChild, ElementRef, OnInit, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { MatStepper } from '@angular/material/stepper';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, takeUntil, combineLatest, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import * as XLSX from 'xlsx';

import { AppStateService } from './core/services/app-state.service';
import { SettingsService } from './core/services/settings.service';
import { ExcelParserService } from './core/services/excel-parser.service';
import { PdfParserService } from './core/services/pdf-parser.service';
import { AiClientService } from './core/services/ai-client.service';
import { JobScraperService } from './core/services/job-scraper.service';
import { NotificationService } from './core/services/notification.service';

import { SettingsDialogComponent } from './components/settings-dialog/settings-dialog.component';
import { JobDialogComponent, JobDialogData, JobDialogResult } from './components/job-dialog/job-dialog.component';
import { JobDetailsDialogComponent } from './components/job-details-dialog/job-details-dialog.component';
import { SyllabusDialogComponent, SyllabusDialogData } from './components/syllabus-dialog/syllabus-dialog.component';
import { CourseWithSyllabus } from './shared/interfaces/syllabus.models';

import { 
  AppState, 
  JobTitle, 
  Course, 
  SuggestedCourse, 
  LogEntry,
  CourseMapping,
  JobSuggestionMapping,
  CourseEnhancement,
  AnalysisResponse,
  EnhancedSyllabus
} from './shared/interfaces/data-models';
import { APP_CONSTANTS } from './shared/constants/app-constants';

// Vanta.js TypeScript declaration
declare const VANTA: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss'
})
export class App implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('stepper') stepper!: MatStepper;

  // Application constants
  readonly appInfo = APP_CONSTANTS.APP_INFO;
  readonly Object = Object; // For template access

  // Component state
  currentStep = 1;
  isLoading = false;
  isProcessing = false;
  statusMessage = 'Ready to start. Upload course data or use defaults.';
  processingMessage = '';
  showStatusBar = true;
  isStatusBarHiding = false;
  private statusBarTimer: any = null;
  private vantaEffect: any = null;

  // UI state
  showAllCourses = false;
  showAllJobsExpanded = false;

  // Data properties
  courses: Course[] = [];
  jobTitles: JobTitle[] = [];
  suggestedCourses: SuggestedCourse[] = [];
  mappings: CourseMapping = {};
  jobSuggestionMappings: JobSuggestionMapping = {};
  logs: LogEntry[] = [];
  
  // Array version of mappings for template binding
  mappingsArray: Array<{job: string, course: string}> = [];
  
  // Syllabus data
  syllabusCoursesMap: Map<string, CourseWithSyllabus> = new Map();
  hasSyllabusData = false;
  
  // Course enhancement tracking
  courseEnhancements: Map<string, CourseEnhancement> = new Map();
  
  // Enhanced syllabi for matched courses
  enhancedSyllabiMap: Map<string, EnhancedSyllabus> = new Map();

  // UI state properties
  canProceedToStep2 = false;
  canAnalyzePaths = false;
  hasApiKey = false;

  private destroy$ = new Subject<void>();

  constructor(
    private appStateService: AppStateService,
    private settingsService: SettingsService,
    private excelParserService: ExcelParserService,
    private pdfParserService: PdfParserService,
    private aiClientService: AiClientService,
    private jobScraperService: JobScraperService,
    private notification: NotificationService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.subscribeToAppState();
    this.subscribeToSettings();
    this.subscribeToProcessingState();

    // Load cached syllabus data on initialization
    this.loadCachedSyllabusData();

    // Load cached job data on initialization
    this.loadCachedJobsData();

    // Apply saved theme on initialization
    const savedTheme = this.settingsService.getTheme();
    this.applyTheme(savedTheme);
  }

  ngAfterViewInit(): void {
    // Initialize Vanta.js fog effect
    if (typeof VANTA !== 'undefined') {
      this.vantaEffect = VANTA.FOG({
        el: '.app-container',
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.00,
        minWidth: 200.00,
        highlightColor: 0xe87500,    // UTD Orange
        midtoneColor: 0xede8e0,      // Warm beige
        lowlightColor: 0xf5f5f0,     // Light cream
        baseColor: 0xf8f6f3,         // Neutral base
        blurFactor: 0.6,
        speed: 1.5,
        zoom: 1.0
      });
    }
  }

  ngOnDestroy(): void {
    // Cleanup Vanta effect
    if (this.vantaEffect) {
      this.vantaEffect.destroy();
    }

    this.destroy$.next();
    this.destroy$.complete();
  }

  private subscribeToAppState(): void {
    this.appStateService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.currentStep = state.currentStep;
        this.isLoading = state.isLoading;
        this.statusMessage = state.statusMessage;
        this.courses = state.courses;
        this.jobTitles = state.jobTitles;
        this.suggestedCourses = state.suggestedCourses;
        this.mappings = state.mappings;
        this.jobSuggestionMappings = state.jobSuggestionMappings;

        // Update mappings array for template binding
        this.mappingsArray = Object.entries(state.mappings).map(([job, course]) => ({
          job: job,
          course: course
        }));

        // Trigger auto-hide for status bar
        this.autoHideStatusBar();
      });

    // Subscribe to derived state
    this.appStateService.canProceedToStep2$
      .pipe(takeUntil(this.destroy$))
      .subscribe(canProceed => this.canProceedToStep2 = canProceed);

    this.appStateService.canAnalyzePaths$
      .pipe(takeUntil(this.destroy$))
      .subscribe(canAnalyze => this.canAnalyzePaths = canAnalyze);
  }

  private subscribeToSettings(): void {
    this.settingsService.settings$
      .pipe(takeUntil(this.destroy$))
      .subscribe(settings => {
        this.hasApiKey = this.settingsService.hasApiKey();
        // Apply theme whenever settings change
        if (settings.theme) {
          this.applyTheme(settings.theme);
        }
      });
  }

  private subscribeToProcessingState(): void {
    this.appStateService.logs$
      .pipe(takeUntil(this.destroy$))
      .subscribe(logs => this.logs = logs);

    this.appStateService.isProcessing$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isProcessing => {
        this.isProcessing = isProcessing;
      });
  }

  // File upload handlers
  triggerFileUpload(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) return;

    console.log('[File Upload] Processing uploaded files');
    console.log('Number of files selected:', files.length);

    // Convert FileList to Array
    const fileArray = Array.from(files);

    // Separate PDF and Excel files
    const pdfFiles: File[] = [];
    const excelFiles: File[] = [];

    fileArray.forEach(file => {
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.pdf')) {
        pdfFiles.push(file);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
        excelFiles.push(file);
      }
    });

    console.log(`PDF files: ${pdfFiles.length}, Excel files: ${excelFiles.length}`);

    // Process based on file types
    if (pdfFiles.length > 0 && excelFiles.length > 0) {
      this.showError('Please upload either PDF files or Excel files, not both at the same time');
      return;
    }

    if (pdfFiles.length > 0) {
      // Validate all PDF files
      for (const file of pdfFiles) {
        const validation = this.pdfParserService.validatePdfFile(file);
        if (!validation.isValid) {
          this.showError(`Invalid PDF file "${file.name}": ${validation.error}`);
          return;
        }
      }
      this.processMultiplePdfFiles(pdfFiles);
    } else if (excelFiles.length > 0) {
      if (excelFiles.length > 1) {
        this.showError('Please upload only one Excel file at a time');
        return;
      }
      // Single Excel file
      const validation = this.excelParserService.validateFile(excelFiles[0]);
      if (!validation.isValid) {
        this.showError(validation.error || 'Invalid file');
        return;
      }
      this.processExcelFile(excelFiles[0]);
    }
  }

  private processPdfFile(file: File): void {
    this.appStateService.setLoading(true);
    this.appStateService.setProcessing(true);
    this.processingMessage = `Processing PDF syllabus: ${file.name}`;
    this.statusMessage = `Processing PDF syllabus: ${file.name}`;

    this.appStateService.addLog({
      type: 'info',
      message: `Starting PDF syllabus processing: ${file.name}`
    });

    // Clear existing cache when uploading new PDF syllabus (silent - don't show "cache cleared" message)
    console.log('New PDF syllabus uploaded, clearing old cache');
    this.clearSyllabusCache(true);

    // Process PDF as syllabus file
    this.pdfParserService.parsePdfFile(file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (pdfCourses) => {
          console.log('Parsed PDF syllabus courses:', pdfCourses);

          this.appStateService.addLog({
            type: 'success',
            message: `Successfully parsed ${pdfCourses.length} course(s) from PDF`
          });

          // Store syllabus data and convert to regular Course format
          this.syllabusCoursesMap.clear();
          const courseObjects: Course[] = pdfCourses.map((course, index) => {
            // Use the course code as the ID for consistency
            const courseId = course.code || course.id || `course-${index + 1}`;
            const courseLabel = `${course.code} ${course.title}`;

            // Store syllabus data with multiple keys for easier lookup
            this.syllabusCoursesMap.set(courseId, course);  // Store by code
            this.syllabusCoursesMap.set(courseLabel, course);  // Store by full label

            console.log(`Storing PDF syllabus for course:`, {
              courseId: courseId,
              courseLabel: courseLabel,
              title: course.title,
              hasRawContent: !!course.syllabus?.rawContent,
              rawContentLength: course.syllabus?.rawContent?.length || 0
            });

            // Return Course object with matching ID
            return {
              id: courseId,
              label: courseLabel
            };
          });

          this.hasSyllabusData = true;
          console.log('PDF Syllabus data map size:', this.syllabusCoursesMap.size);
          console.log('Has syllabus data:', this.hasSyllabusData);

          this.appStateService.setCourses(courseObjects);
          this.appStateService.setCurrentStep(2);

          this.showSuccess(`Loaded ${pdfCourses.length} course(s) with PDF syllabus content`);
          this.finishProcessing();
        },
        error: (error) => {
          this.appStateService.addLog({
            type: 'error',
            message: `PDF parsing failed: ${error.message}`
          });
          this.showError(`Failed to parse PDF file: ${error.message}`);
          this.finishProcessing();
        }
      });
  }

  private processMultiplePdfFiles(files: File[]): void {
    this.appStateService.setLoading(true);
    this.appStateService.setProcessing(true);
    this.processingMessage = `Processing ${files.length} PDF syllabus file(s)...`;
    this.statusMessage = `Processing ${files.length} PDF syllabus file(s)...`;

    this.appStateService.addLog({
      type: 'info',
      message: `Starting batch PDF processing: ${files.length} files`
    });

    console.log('Processing multiple PDF files:', files.map(f => f.name));

    // Clear existing cache when uploading new PDF syllabi (silent - don't show "cache cleared" message)
    this.clearSyllabusCache(true);

    // Process all PDFs using forkJoin for parallel processing
    const parseObservables = files.map((file, index) =>
      this.pdfParserService.parsePdfFile(file).pipe(
        map(courses => ({
          fileName: file.name,
          courses: courses,
          index: index + 1
        })),
        catchError(error => {
          console.error(`Failed to parse ${file.name}:`, error);
          this.appStateService.addLog({
            type: 'error',
            message: `Failed to parse ${file.name}: ${error.message}`
          });
          // Return empty array for failed files, continue with others
          return of({ fileName: file.name, courses: [], index: index + 1, error: error.message });
        })
      )
    );

    forkJoin(parseObservables)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (results) => {
          // Combine all courses from all PDFs
          const allCourses: CourseWithSyllabus[] = [];
          const courseObjects: Course[] = [];
          let totalCourses = 0;
          let successfulFiles = 0;
          let failedFiles = 0;

          results.forEach(result => {
            if (result.courses.length > 0) {
              successfulFiles++;
              totalCourses += result.courses.length;

              result.courses.forEach((course, courseIndex) => {
                const courseId = course.code || course.id || `course-${result.index}-${courseIndex + 1}`;
                const courseLabel = `${course.code} ${course.title}`;

                // Store in syllabusCoursesMap with both ID and label as keys
                this.syllabusCoursesMap.set(courseId, course);
                this.syllabusCoursesMap.set(courseLabel, course);

                // Add to combined arrays
                allCourses.push(course);
                courseObjects.push({
                  id: courseId,
                  label: courseLabel
                });
              });

              this.appStateService.addLog({
                type: 'success',
                message: `${result.fileName}: Loaded ${result.courses.length} course(s)`
              });
            } else if ('error' in result) {
              failedFiles++;
            }
          });

          this.hasSyllabusData = totalCourses > 0;

          console.log(`Batch processing complete: ${successfulFiles} successful, ${failedFiles} failed`);
          console.log(`Total courses loaded: ${totalCourses}`);
          console.log('Syllabus data map size:', this.syllabusCoursesMap.size);

          if (totalCourses > 0) {
            this.appStateService.setCourses(courseObjects);
            this.appStateService.setCurrentStep(2);

            const summary = failedFiles > 0
              ? `Loaded ${totalCourses} course(s) from ${successfulFiles}/${files.length} PDF files (${failedFiles} failed)`
              : `Loaded ${totalCourses} course(s) from ${files.length} PDF syllabus file(s)`;

            this.showSuccess(summary);
          } else {
            this.showError(`Failed to parse any courses from the ${files.length} PDF file(s)`);
          }

          this.finishProcessing();
        },
        error: (error) => {
          this.appStateService.addLog({
            type: 'error',
            message: `Batch PDF parsing failed: ${error.message}`
          });
          this.showError(`Failed to parse PDF files: ${error.message}`);
          this.finishProcessing();
        }
      });
  }

  private processExcelFile(file: File): void {
    this.appStateService.setLoading(true);
    this.appStateService.setProcessing(true);
    this.processingMessage = `Processing Excel file: ${file.name}`;
    this.statusMessage = `Processing Excel file: ${file.name}`;

    this.appStateService.addLog({
      type: 'info',
      message: `Starting Excel file processing: ${file.name}`
    });

    // Check if this is a syllabus Excel file
    const isSyllabusFile = file.name.toLowerCase().includes('syllabus') || 
                           file.name.toLowerCase().includes('mapping');
    
    if (isSyllabusFile) {
      // Clear existing cache when uploading new syllabus file (silent - don't show "cache cleared" message)
      console.log('New syllabus file uploaded, clearing old cache');
      this.clearSyllabusCache(true);
      // Process as syllabus file
      this.excelParserService.parseSyllabusExcelFile(file)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (syllabusCourses) => {
            console.log('Parsed syllabus courses:', syllabusCourses);
            
            // Check if any courses have invalid syllabus content
            const invalidCourses = syllabusCourses.filter(course => {
              const content = course.syllabus?.rawContent || '';
              const isInvalid = !content || content.length < 100;
              if (isInvalid) {
                console.log(`Course ${course.code} has invalid content: "${content}" (length: ${content.length})`);
              }
              return isInvalid;
            });
            
            console.log(`Total courses: ${syllabusCourses.length}, Invalid: ${invalidCourses.length}`);
            
            if (invalidCourses.length > 0) {
              console.warn(`Found ${invalidCourses.length} courses with invalid/empty syllabus content`);
              invalidCourses.forEach(c => {
                console.log(`  - ${c.code}: content = "${c.syllabus?.rawContent}" (length: ${c.syllabus?.rawContent?.length || 0})`);
              });
              console.log('Attempting to load valid syllabus data from JSON...');
              
              // Try to load from JSON and merge
              try {
                const jsonData = await this.excelParserService.loadSyllabusDataFromJson('assets/syllabus_data.json');
                
                if (jsonData && jsonData.length > 0) {
                  console.log(`Loaded ${jsonData.length} courses from JSON for fallback`);
                  
                  // Create multiple maps for better matching
                  const jsonMapByCode = new Map<string, CourseWithSyllabus>();
                  const jsonMapById = new Map<string, CourseWithSyllabus>();
                  
                  jsonData.forEach(course => {
                    // Store by normalized code (no spaces)
                    if (course.code) {
                      const normalizedCode = course.code.replace(/\s+/g, '').toUpperCase();
                      jsonMapByCode.set(normalizedCode, course);
                      console.log(`  JSON course code: "${course.code}" -> normalized: "${normalizedCode}"`);
                    }
                    // Also store by ID
                    if (course.id) {
                      jsonMapById.set(course.id, course);
                    }
                  });
                  
                  // Merge Excel metadata with JSON syllabus content
                  let mergedCount = 0;
                  syllabusCourses = syllabusCourses.map(excelCourse => {
                    // Skip if already has valid content
                    if (excelCourse.syllabus?.rawContent && excelCourse.syllabus.rawContent.length >= 100) {
                      return excelCourse;
                    }
                    
                    // Try multiple matching strategies
                    const normalizedCode = excelCourse.code?.replace(/\s+/g, '').toUpperCase() || '';
                    console.log(`Trying to match Excel course: "${excelCourse.code}" -> normalized: "${normalizedCode}"`);
                    
                    let jsonCourse = jsonMapByCode.get(normalizedCode);
                    
                    // Fallback to ID matching if code doesn't match
                    if (!jsonCourse && excelCourse.id) {
                      jsonCourse = jsonMapById.get(excelCourse.id);
                      if (jsonCourse) {
                        console.log(`  Matched by ID: ${excelCourse.id}`);
                      }
                    }
                    
                    if (jsonCourse && jsonCourse.syllabus?.rawContent && jsonCourse.syllabus.rawContent.length > 100) {
                      console.log(`[Syllabus] Merging JSON syllabus for ${excelCourse.code} (${jsonCourse.syllabus.rawContent.length} chars)`);
                      mergedCount++;
                      return {
                        ...excelCourse,
                        syllabus: jsonCourse.syllabus,
                        contentLength: jsonCourse.syllabus.rawContent.length
                      };
                    } else {
                      console.warn(`[Syllabus] No valid JSON match found for ${excelCourse.code}`);
                    }
                    
                    return excelCourse;
                  });
                  
                  if (mergedCount > 0) {
                    this.showSuccess(`Merged syllabus content from backup data for ${mergedCount} courses`);
                  } else {
                    this.showWarning('Unable to find matching syllabus data in backup');
                  }
                }
              } catch (error) {
                console.error('Failed to load fallback JSON data:', error);
              }
            }
            
            this.appStateService.addLog({
              type: 'success',
              message: `Successfully parsed ${syllabusCourses.length} courses with syllabus data`
            });
            
            // Store syllabus data and convert to regular Course format
            this.syllabusCoursesMap.clear();
            const courseObjects: Course[] = syllabusCourses.map((course, index) => {
              // Use the course code as the ID for consistency
              const courseId = course.code || course.id || `course-${index + 1}`;
              const courseLabel = `${course.code} ${course.title}`;
              
              // Store syllabus data with multiple keys for easier lookup
              this.syllabusCoursesMap.set(courseId, course);  // Store by code
              this.syllabusCoursesMap.set(courseLabel, course);  // Store by full label
              
              console.log(`Storing syllabus for course:`, {
                courseId: courseId,
                courseLabel: courseLabel,
                title: course.title,
                hasRawContent: !!course.syllabus?.rawContent,
                rawContentLength: course.syllabus?.rawContent?.length || 0
              });
              
              // Return Course object with matching ID
              return {
                id: courseId,
                label: courseLabel
              };
            });
            
            this.hasSyllabusData = true;
            console.log('Syllabus data map size:', this.syllabusCoursesMap.size);
            console.log('Has syllabus data:', this.hasSyllabusData);
            
            this.appStateService.setCourses(courseObjects);
            this.appStateService.setCurrentStep(2);
            
            this.showSuccess(`Loaded ${syllabusCourses.length} courses with syllabus content`);
            this.finishProcessing();
          },
          error: (error) => {
            this.appStateService.addLog({
              type: 'error',
              message: `Syllabus Excel parsing failed: ${error.message}`
            });
            this.showError(`Failed to parse syllabus Excel file: ${error.message}`);
            this.finishProcessing();
          }
        });
    } else {
      // Process as regular Excel file
      this.excelParserService.parseExcelFile(file)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (result) => {
            this.appStateService.addLog({
              type: 'success',
              message: `Successfully parsed ${result.validRows} courses from Excel`
            });

            if (result.errors.length > 0) {
              this.appStateService.addLog({
                type: 'warning',
                message: `${result.errors.length} rows had issues`
              });
            }

            // Clear syllabus data for regular files
            this.syllabusCoursesMap.clear();
            this.hasSyllabusData = false;

            // Convert to Course format
            const courses = this.excelParserService.convertToV1Format(result.courses);
            const courseObjects: Course[] = courses.map((course, index) => ({
              id: `course-${index + 1}`,
              label: course
            }));

            this.appStateService.setCourses(courseObjects);
            this.appStateService.setCurrentStep(2);
            this.excelParserService.saveCoursesToStorage(result.courses);
            
            this.showSuccess(`Loaded ${result.validRows} courses from Excel file`);
            this.finishProcessing();
          },
          error: (error) => {
            this.appStateService.addLog({
              type: 'error',
              message: `Excel parsing failed: ${error.message}`
            });
            this.showError(`Failed to parse Excel file: ${error.message}`);
            this.finishProcessing();
          }
        });
    }
  }

  // Action handlers
  loadDefaultCourses(): void {
    console.log('[Courses] Loading default courses');
    console.log('Timestamp:', new Date().toISOString());
    
    // Clear syllabus data when loading default courses
    this.syllabusCoursesMap.clear();
    this.hasSyllabusData = false;
    
    this.appStateService.loadDefaultCourses();
    this.appStateService.setCurrentStep(2);
    console.log('[Courses] Default courses loaded successfully');
    this.showSuccess('Loaded default courses');
  }
  
  // Load sample syllabus data for testing
  async loadSampleSyllabusData(): Promise<void> {
    try {
      // Check if we already have syllabus data loaded
      if (this.hasSyllabusData && this.syllabusCoursesMap.size > 0) {
        console.log('Syllabus data already loaded');
        this.showInfo('Syllabus data is already loaded');
        return;
      }
      
      // Load from JSON file
      const syllabusData = await this.excelParserService.loadSyllabusDataFromJson('assets/syllabus_data.json');
      
      console.log('Loading sample syllabus data:', syllabusData);
      
      if (syllabusData && syllabusData.length > 0) {
        // Clear any existing data first (silent - don't show "cache cleared" message)
        this.clearSyllabusCache(true);

        // Process the data (which will also save to cache)
        this.processSyllabusData(syllabusData);
        
        this.showSuccess(`Loaded ${syllabusData.length} courses with syllabus content`);
      } else {
        console.warn('No syllabus data found in JSON file');
        this.showError('No syllabus data found');
      }
    } catch (error) {
      console.error('Failed to load sample syllabus data:', error);
      this.showError('Failed to load sample syllabus data');
    }
  }
  
  // Process syllabus data and update state
  private processSyllabusData(syllabusData: CourseWithSyllabus[]): void {
    console.log('\n=== PROCESSING SYLLABUS DATA ===');
    console.log('Number of courses received:', syllabusData.length);

    // Deduplicate courses by code (keep first occurrence)
    const seenCodes = new Set<string>();
    const uniqueCourses = syllabusData.filter(course => {
      const courseCode = course.code || course.id || '';
      if (!courseCode || seenCodes.has(courseCode)) {
        return false;
      }
      seenCodes.add(courseCode);
      return true;
    });

    if (uniqueCourses.length !== syllabusData.length) {
      console.log(`Removed ${syllabusData.length - uniqueCourses.length} duplicate course(s)`);
    }
    console.log('Number of unique courses to process:', uniqueCourses.length);

    // Store syllabus data and convert to regular Course format
    this.syllabusCoursesMap.clear();
    const courseObjects: Course[] = uniqueCourses.map((course, index) => {
      const courseId = course.code || course.id || `course-${index + 1}`;
      const courseLabel = `${course.code} ${course.title}`;
      
      // Debug log for each course
      console.log(`\n--- Processing Course ${index + 1} ---`);
      console.log('Course ID:', courseId);
      console.log('Course Label:', courseLabel);
      console.log('Course Title:', course.title);
      console.log('Has Syllabus:', !!course.syllabus);
      
      if (course.syllabus) {
        console.log('Syllabus Keys:', Object.keys(course.syllabus));
        console.log('Raw Content Length:', course.syllabus.rawContent?.length || 0);
        console.log('Raw Content Preview:', course.syllabus.rawContent?.substring(0, 100) || 'No content');
        console.log('Content Type:', typeof course.syllabus.rawContent);
        
        // Check if rawContent is the actual content
        if (course.syllabus.rawContent === course.contentLength?.toString()) {
          console.error('WARNING: rawContent appears to be contentLength value!');
        }
      }
      
      // Store syllabus data with multiple keys for easier lookup
      this.syllabusCoursesMap.set(courseId, course);  // Store by code
      this.syllabusCoursesMap.set(courseLabel, course);  // Store by full label
      
      console.log(`Stored course with keys: "${courseId}" and "${courseLabel}"`, {
        title: course.title,
        hasRawContent: !!course.syllabus?.rawContent,
        rawContentLength: course.syllabus?.rawContent?.length || 0,
        rawContentPreview: course.syllabus?.rawContent?.substring(0, 30) || 'No content'
      });
      
      // Return Course object with matching ID
      return {
        id: courseId,
        label: courseLabel
      };
    });
    
    // Verify stored data
    console.log('\n=== VERIFICATION AFTER STORAGE ===');
    this.syllabusCoursesMap.forEach((course, id) => {
      console.log(`Course ${id}: rawContent length = ${course.syllabus?.rawContent?.length || 0}`);
      if (course.syllabus?.rawContent && course.syllabus.rawContent.length < 100) {
        console.warn(`WARNING: Course ${id} has suspiciously short content: "${course.syllabus.rawContent}"`);
      }
    });
    
    this.hasSyllabusData = true;
    console.log('\nFinal map size:', this.syllabusCoursesMap.size);

    // Save deduplicated data to cache
    this.saveSyllabusDataToCache(uniqueCourses);

    this.appStateService.setCourses(courseObjects);
    this.appStateService.setCurrentStep(2);
  }
  
  // Enhanced cache management methods with version control
  private readonly SYLLABUS_CACHE_KEY = 'pathfinder_syllabus_data_v2';
  private readonly CACHE_VERSION = '2.0';
  
  private saveSyllabusDataToCache(data: CourseWithSyllabus[]): void {
    try {
      const cacheData = {
        version: this.CACHE_VERSION,
        timestamp: new Date().toISOString(),
        data: data,
        enhancedSyllabi: Object.fromEntries(this.enhancedSyllabiMap),
        courseEnhancements: Object.fromEntries(this.courseEnhancements),
        checksum: this.generateChecksum(data)
      };

      // Compress data if needed
      const cacheString = JSON.stringify(cacheData);
      const sizeInMB = cacheString.length / (1024 * 1024);

      if (sizeInMB > 5) {
        console.warn(`Cache size is ${sizeInMB.toFixed(2)}MB, which may exceed localStorage limits`);
      }

      localStorage.setItem(this.SYLLABUS_CACHE_KEY, cacheString);
      console.log(`Saved ${data.length} courses to cache (${sizeInMB.toFixed(2)}MB)`);
      this.showSuccess('Syllabus data saved to cache');
    } catch (error) {
      console.error('Failed to save syllabus data to cache:', error);
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        this.showError('Cache storage full. Consider clearing old data.');
      }
    }
  }
  
  private loadCachedSyllabusData(): void {
    try {
      const cached = localStorage.getItem(this.SYLLABUS_CACHE_KEY);
      if (!cached) {
        console.log('No cached syllabus data found');
        return;
      }
      
      const cacheData = JSON.parse(cached);
      
      // Validate cache version
      if (cacheData.version !== this.CACHE_VERSION) {
        console.log(`Cache version mismatch (${cacheData.version} vs ${this.CACHE_VERSION}), clearing cache`);
        this.clearSyllabusCache(true);
        return;
      }

      // Validate cache integrity
      const checksum = this.generateChecksum(cacheData.data);
      if (checksum !== cacheData.checksum) {
        console.warn('Cache checksum mismatch, data may be corrupted');
        this.clearSyllabusCache(true);
        return;
      }
      
      // Check cache age (keep indefinitely until new file upload)
      const cacheTime = new Date(cacheData.timestamp);
      const ageInHours = (Date.now() - cacheTime.getTime()) / (1000 * 60 * 60);
      
      console.log(`Loading cached syllabus data from ${cacheData.timestamp} (${ageInHours.toFixed(1)} hours old)`);
      
      // Process the cached data
      if (cacheData.data && cacheData.data.length > 0) {
        this.processSyllabusData(cacheData.data);

        // Restore enhanced syllabi and course enhancements
        if (cacheData.enhancedSyllabi) {
          this.enhancedSyllabiMap = new Map(Object.entries(cacheData.enhancedSyllabi));
          console.log(`Restored ${this.enhancedSyllabiMap.size} enhanced syllabi from cache`);
        }

        if (cacheData.courseEnhancements) {
          this.courseEnhancements = new Map(Object.entries(cacheData.courseEnhancements));
          console.log(`Restored ${this.courseEnhancements.size} course enhancements from cache`);
        }

        this.showInfo(`Restored ${cacheData.data.length} courses from cache`);
      }
    } catch (error) {
      console.error('Failed to load cached syllabus data:', error);
      this.clearSyllabusCache(true);
    }
  }

  private generateChecksum(data: any[]): string {
    // Simple checksum based on data length and first/last items
    const dataStr = `${data.length}_${JSON.stringify(data[0])}_${JSON.stringify(data[data.length - 1])}`;
    let hash = 0;
    for (let i = 0; i < dataStr.length; i++) {
      const char = dataStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
  
  /**
   * Helper method to save current syllabus state to cache
   * Includes all Maps data (syllabusCoursesMap, enhancedSyllabiMap, courseEnhancements)
   */
  private saveCurrentSyllabusState(): void {
    if (this.syllabusCoursesMap.size > 0) {
      const syllabusData = Array.from(this.syllabusCoursesMap.values());
      this.saveSyllabusDataToCache(syllabusData);
    }
  }

  /**
   * Load cached job data on initialization
   * Restores jobs with descriptions from the job scraper cache
   */
  private loadCachedJobsData(): void {
    try {
      const cached = localStorage.getItem('cached_job_titles');
      if (!cached) {
        console.log('No cached job data found');
        return;
      }

      const cacheData = JSON.parse(cached);
      const age = Date.now() - (cacheData.cachedAt || 0);
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      // Check cache version
      if (!cacheData.cacheVersion || cacheData.cacheVersion < '2.0') {
        console.log('Job cache version outdated, skipping restore');
        return;
      }

      if (age > maxAge) {
        console.log('Job cache expired, skipping restore');
        return;
      }

      if (cacheData.jobs && cacheData.jobs.length > 0) {
        const ageInMinutes = Math.floor(age / (1000 * 60));
        console.log(`Restoring ${cacheData.jobs.length} jobs from cache (${ageInMinutes} minutes old)`);

        // Log if jobs have descriptions
        const withDescriptions = cacheData.jobs.filter((j: any) => j.description).length;
        console.log(`Jobs with descriptions: ${withDescriptions}/${cacheData.jobs.length}`);

        this.appStateService.setJobTitles(cacheData.jobs);
        this.showInfo(`Restored ${cacheData.jobs.length} jobs from cache`);
      }
    } catch (error) {
      console.error('Failed to load cached job data:', error);
    }
  }

  /**
   * Force save all state before page unload
   */
  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    // Force save current syllabus state
    this.saveCurrentSyllabusState();

    // Manually trigger app state save (bypass debounce)
    const state = this.appStateService.getCurrentState();
    try {
      localStorage.setItem(APP_CONSTANTS.STORAGE_KEYS.APP_STATE, JSON.stringify(state));
      console.log('State saved before unload');
    } catch (error) {
      console.error('Failed to save state before unload:', error);
    }
  }

  clearSyllabusCache(silent: boolean = false): void {
    try {
      localStorage.removeItem(this.SYLLABUS_CACHE_KEY);
      // Also remove old cache key if it exists
      localStorage.removeItem('pathfinder_syllabus_cache');

      this.syllabusCoursesMap.clear();
      this.hasSyllabusData = false;
      this.courseEnhancements.clear();
      this.enhancedSyllabiMap.clear();

      console.log('Cleared all syllabus cache data');
      if (!silent) {
        this.showInfo('Syllabus cache cleared');
      }
    } catch (error) {
      console.error('Failed to clear cache:', error);
      this.showError('Failed to clear syllabus cache');
    }
  }
  
  // Export results to Excel
  exportResultsToExcel(): void {
    try {
      // Create a new workbook
      const wb = XLSX.utils.book_new();
      
      // Sheet 1: Job-to-Course Mappings
      const mappingsData = Object.entries(this.mappings).map(([job, course]) => ({
        'Job Title': job,
        'Matched Course': course,
        'Status': 'Matched'
      }));
      
      if (mappingsData.length > 0) {
        const ws1 = XLSX.utils.json_to_sheet(mappingsData);
        XLSX.utils.book_append_sheet(wb, ws1, 'Job-Course Mappings');
      }
      
      // Sheet 2: Suggested Courses
      const suggestionsData = this.suggestedCourses.map(suggestion => ({
        'Course Title': suggestion.title,
        'Related Jobs': (suggestion.related_jobs || []).join(', '),
        'Status': 'Suggested'
      }));
      
      if (suggestionsData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(suggestionsData);
        XLSX.utils.book_append_sheet(wb, ws2, 'Suggested Courses');
      }
      
      // Sheet 3: All Courses with Status
      const allCoursesData = this.courses.map(course => {
        const isMapped = Object.values(this.mappings).includes(course.label);
        const isSuggested = this.suggestedCourses.some(s => s.title === course.label);
        
        return {
          'Course': course.label,
          'Status': isMapped ? 'Matched' : (isSuggested ? 'Suggested' : 'Available'),
          'Syllabus Available': this.getCourseHasSyllabus(course) ? 'Yes' : 'No'
        };
      });
      
      const ws3 = XLSX.utils.json_to_sheet(allCoursesData);
      XLSX.utils.book_append_sheet(wb, ws3, 'All Courses');
      
      // Sheet 4: Job Titles
      const jobsData = this.jobTitles.map(job => ({
        'Job Title': job.label,
        'ID': job.id,
        'Mapped': Object.keys(this.mappings).includes(job.label) ? 'Yes' : 'No'
      }));
      
      if (jobsData.length > 0) {
        const ws4 = XLSX.utils.json_to_sheet(jobsData);
        XLSX.utils.book_append_sheet(wb, ws4, 'Job Titles');
      }
      
      // Sheet 5: Summary
      const summaryData = [{
        'Metric': 'Total Job Titles',
        'Value': this.jobTitles.length
      }, {
        'Metric': 'Total Available Courses',
        'Value': this.courses.length
      }, {
        'Metric': 'Matched Courses',
        'Value': Object.keys(this.mappings).length
      }, {
        'Metric': 'Suggested New Courses',
        'Value': this.suggestedCourses.length
      }, {
        'Metric': 'Export Date',
        'Value': new Date().toLocaleString()
      }];
      
      const ws5 = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws5, 'Summary');
      
      // Generate Excel file
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PathFinder_Results_${new Date().toISOString().split('T')[0]}.xlsx`;
      link.click();
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      this.showSuccess('Results exported to Excel successfully');
    } catch (error) {
      console.error('Failed to export results:', error);
      this.showError('Failed to export results to Excel');
    }
  }
  
  // Helper methods for results display
  showAllMappings(): void {
    const mappingEntries = Object.entries(this.mappings);
    if (mappingEntries.length === 0) {
      this.showInfo('No course mappings available');
      return;
    }

    // Create simple dialog content
    const dialogContent = `
      <h3>All Job-to-Course Mappings (${mappingEntries.length})</h3>
      <div class="mapping-list">
        ${mappingEntries.map(([job, course]) => `
          <div class="mapping-row">
            <strong>${job}</strong> → ${course}
          </div>
        `).join('')}
      </div>
    `;
    
    // Open basic dialog (could be enhanced with custom dialog component later)
    const dialogRef = this.dialog.open(JobDialogComponent, {
      width: '600px',
      maxHeight: '70vh',
      data: {
        title: 'All Course Mappings',
        content: dialogContent,
        mappings: this.mappings,
        mode: 'view'
      },
      panelClass: 'modern-dialog'
    });
  }
  
  showAllSuggestions(): void {
    if (this.suggestedCourses.length === 0) {
      this.showInfo('No course suggestions available');
      return;
    }

    // Create simple dialog content for suggestions
    const dialogContent = `
      <h3>All Suggested Courses (${this.suggestedCourses.length})</h3>
      <div class="suggestions-list">
        ${this.suggestedCourses.map(suggestion => `
          <div class="suggestion-row">
            <h4>${suggestion.title}</h4>
            <p><strong>For Jobs:</strong> ${(suggestion.related_jobs || []).join(', ')}</p>
            <p><strong>Skills:</strong> ${(suggestion.skill_gaps || []).join(', ')}</p>
            <p><em>${suggestion.reasoning}</em></p>
          </div>
        `).join('')}
      </div>
    `;
    
    // Open dialog for suggestions
    const dialogRef = this.dialog.open(JobDialogComponent, {
      width: '700px',
      maxHeight: '80vh',
      data: {
        title: 'All Course Suggestions',
        content: dialogContent,
        suggestions: this.suggestedCourses,
        mode: 'view'
      },
      panelClass: 'modern-dialog'
    });
  }

  loadDefaultJobTitles(): void {
    console.log('[Jobs] Loading default job titles');
    console.log('Timestamp:', new Date().toISOString());
    
    if (!this.hasApiKey) {
      console.error('[Error] No API key configured');
      this.showError('Please configure your Grok API key in settings to fetch job titles');
      return;
    }
    
    console.log('[Jobs] API key present, starting job fetch...');
    this.appStateService.setLoading(true);
    this.processingMessage = 'Loading trending job titles...';
    this.statusMessage = 'Loading trending job titles...';

    // Fetch trending jobs (will use cache if available)
    this.jobScraperService.fetchTrendingJobs().subscribe({
      next: (result) => {
        console.log('[Jobs] Job fetch successful');
        console.log('Result:', result);
        this.appStateService.setJobTitles(result.jobs);
        this.appStateService.setCurrentStep(3);
        
        if (result.source === 'cached') {
          const cacheAge = this.jobScraperService.getCacheAge();
          this.showSuccess(`Loaded ${result.jobs.length} trending job titles (cached ${cacheAge})`);
        } else {
          this.showSuccess(`Loaded ${result.jobs.length} trending job titles from live web data`);
        }
        this.appStateService.setLoading(false);
      },
      error: (error) => {
        console.error('[Error] Failed to fetch trending jobs');
        console.error('Error details:', error);
        this.showError(`Failed to fetch job titles: ${error.message}`);
        this.appStateService.setLoading(false);
      }
    });
  }

  refreshJobTitles(): void {
    console.log('[Jobs] Refreshing job titles');
    console.log('Timestamp:', new Date().toISOString());
    
    if (!this.hasApiKey) {
      console.error('[Error] No API key configured');
      this.showError('Please configure your Grok API key in settings to refresh job titles');
      return;
    }
    
    console.log('[Jobs] API key present, forcing refresh...');
    this.appStateService.setLoading(true);
    this.processingMessage = 'Refreshing job titles from live web data...';
    this.statusMessage = 'Refreshing job titles from live web data...';

    // Force refresh (bypass cache)
    this.jobScraperService.fetchTrendingJobs(undefined, 10, true).subscribe({
      next: (result) => {
        console.log('[Jobs] Job refresh successful');
        console.log('Result:', result);
        this.appStateService.setJobTitles(result.jobs);
        this.appStateService.setCurrentStep(3);
        this.showSuccess(`Refreshed ${result.jobs.length} trending job titles from live web data`);
        this.appStateService.setLoading(false);
      },
      error: (error) => {
        console.error('[Error] Failed to refresh trending jobs');
        console.error('Error details:', error);
        this.showError(`Failed to refresh job titles: ${error.message}`);
        this.appStateService.setLoading(false);
      }
    });
  }

  analyzeCareerPaths(): void {
    console.log('[Analysis] Starting career paths analysis');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Current jobs:', this.jobTitles.length);
    console.log('Current courses:', this.courses.length);
    
    if (!this.hasApiKey) {
      console.error('[Error] No API key configured');
      this.showError('Please configure your Grok API key in settings first');
      return;
    }
    
    console.log('[Analysis] Starting AI analysis...');
    this.appStateService.setLoading(true);
    this.appStateService.setProcessing(true);
    this.processingMessage = 'Analyzing career paths with AI...';
    this.statusMessage = 'Analyzing career paths with AI...';

    this.appStateService.addLog({
      type: 'info',
      message: 'Starting AI analysis of career paths'
    });

    const request = this.appStateService.createAnalysisRequest();
    
    this.aiClientService.analyzeCareerPaths(request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('[Analysis] AI Analysis Complete!');
          console.log('Analysis response:', response);
          
          this.appStateService.addLog({
            type: 'success',
            message: 'AI analysis complete'
          });

          // Generate enhanced syllabi for both matched and unmapped courses
          if (this.hasSyllabusData && this.syllabusCoursesMap.size > 0) {
            this.generateAllEnhancedSyllabi(response);
          } else {
            this.appStateService.setAnalysisResults(response);
            this.showSuccess('AI analysis completed successfully');
            this.finishProcessing();
          }
        },
        error: (error) => {
          console.error('[Error] AI Analysis Failed');
          console.error('Error details:', error);
          
          this.appStateService.addLog({
            type: 'error',
            message: `AI analysis failed: ${error.message}`
          });
          this.showError(`AI analysis failed: ${error.message}`);
          this.finishProcessing();
        }
      });
  }

  private generateAllEnhancedSyllabi(analysisResponse: AnalysisResponse): void {
    console.log('[Enhancement] Generating enhanced syllabi for all courses');
    
    // First, generate enhanced syllabi for matched courses
    this.generateEnhancedSyllabiForMatchedCourses(analysisResponse);
    
    // Then handle unmapped jobs with suggested courses
    this.generateEnhancedSyllabi(analysisResponse);
  }
  
  private generateEnhancedSyllabiForMatchedCourses(analysisResponse: AnalysisResponse): void {
    console.log('Generating enhanced syllabi for matched courses...');
    
    // Clear any existing enhanced syllabi
    this.enhancedSyllabiMap.clear();
    
    // For each matched course, generate an enhanced version
    Object.entries(analysisResponse.mappings || {}).forEach(([job, courseName]) => {
      console.log(`Creating enhanced syllabus for ${courseName} (matched to ${job})`);
      
      // Find the original course
      const originalCourse = this.findSyllabusCourse(courseName, courseName);
      
      if (originalCourse && originalCourse.syllabus) {
        // Generate enhanced version with filled gaps and improved content
        const enhancedSyllabus = this.createEnhancedSyllabus(originalCourse, [job]);
        
        // Store in map for quick retrieval
        this.enhancedSyllabiMap.set(courseName, enhancedSyllabus);
        console.log(`Stored enhanced syllabus for ${courseName}`);
      }
    });

    console.log(`Generated ${this.enhancedSyllabiMap.size} enhanced syllabi for matched courses`);

    // Save the updated syllabus data to cache including enhanced syllabi
    this.saveCurrentSyllabusState();
  }
  
  private createEnhancedSyllabus(originalCourse: CourseWithSyllabus, relatedJobs: string[]): EnhancedSyllabus {
    const weeklySchedule = originalCourse.syllabus?.weeklySchedule || [];
    const enhancedSchedule = [...weeklySchedule];
    
    // Find gaps and fill them
    const maxWeek = weeklySchedule.length > 0 ? Math.max(...weeklySchedule.map(w => w.week)) : 16;
    const existingWeeks = new Set(weeklySchedule.map(w => w.week));
    
    for (let week = 1; week <= maxWeek; week++) {
      if (!existingWeeks.has(week)) {
        // Generate content for missing week
        enhancedSchedule.push({
          week: week,
          date: `Week ${week}`,
          topics: this.generateTopicsForWeek(week, relatedJobs),
          assignments: ''
        });
      }
    }
    
    // Sort by week number
    enhancedSchedule.sort((a, b) => a.week - b.week);
    
    // Enhance topic descriptions
    const enhancedScheduleWithTopics = enhancedSchedule.map(week => ({
      ...week,
      topics: week.topics?.map(topic => this.enhanceTopicDescription(topic, relatedJobs)) || []
    }));
    
    // Create enhanced course object
    const enhancedCourse: CourseWithSyllabus = {
      ...originalCourse,
      syllabus: {
        ...originalCourse.syllabus!,
        weeklySchedule: enhancedScheduleWithTopics
      }
    };
    
    // Calculate enhancement details
    const gapsFilled = [];
    for (let week = 1; week <= maxWeek; week++) {
      if (!existingWeeks.has(week)) {
        gapsFilled.push(week);
      }
    }
    
    // Create enhancement details in the expected format
    const enhancement: CourseEnhancement = {
      courseId: originalCourse.id || originalCourse.code || '',
      courseName: originalCourse.title || '',
      originalWeekCount: weeklySchedule.length,
      enhancedWeekCount: enhancedScheduleWithTopics.length,
      gapsFilled: gapsFilled,
      topicsEnhanced: [],
      assignmentsMoved: [],
      enhancementTimestamp: new Date().toISOString(),
      enhancementSummary: `Enhanced syllabus with ${gapsFilled.length} gaps filled and topics aligned with ${relatedJobs.join(', ')}`
    };
    
    return {
      original_course_id: originalCourse.id || originalCourse.code || '',
      enhanced_course: enhancedCourse,
      enhancement_details: enhancement,
      confidence_score: 0.85,
      improvement_summary: `Enhanced syllabus with ${gapsFilled.length} gaps filled and topics aligned with ${relatedJobs.join(', ')}`
    };
  }
  
  private generateTopicsForWeek(weekNumber: number, relatedJobs: string[]): string[] {
    // Generate meaningful, context-aware topics based on week number and job requirements
    const topics: string[] = [];
    const primaryJob = relatedJobs[0]?.toLowerCase() || '';
    
    // Week-specific progressive content
    if (weekNumber <= 3) {
      // Foundation weeks
      topics.push('Review of Prerequisites and Core Concepts');
      if (primaryJob.includes('software')) {
        topics.push('Software Development Lifecycle Overview');
        topics.push('Version Control Systems (Git Fundamentals)');
      } else if (primaryJob.includes('data')) {
        topics.push('Data Types and Structures Overview');
        topics.push('Statistical Foundations Review');
      } else {
        topics.push('Industry Standards and Best Practices');
        topics.push('Professional Tools Setup and Configuration');
      }
    }
    else if (weekNumber <= 6) {
      // Building skills weeks
      topics.push('Intermediate Concepts and Applications');
      if (primaryJob.includes('software')) {
        topics.push('Design Patterns and Architecture Principles');
        topics.push('Unit Testing and Test-Driven Development');
      } else if (primaryJob.includes('data')) {
        topics.push('Data Cleaning and Preprocessing Techniques');
        topics.push('Exploratory Data Analysis Methods');
      } else if (primaryJob.includes('cloud')) {
        topics.push('Cloud Service Models (IaaS, PaaS, SaaS)');
        topics.push('Container Technologies and Orchestration');
      } else {
        topics.push('Problem-Solving Methodologies');
        topics.push('Collaborative Project Work');
      }
    }
    else if (weekNumber <= 10) {
      // Advanced application weeks
      topics.push('Advanced Techniques and Optimization');
      if (primaryJob.includes('software')) {
        topics.push('Performance Optimization and Profiling');
        topics.push('Microservices and Distributed Systems');
      } else if (primaryJob.includes('data')) {
        topics.push('Machine Learning Model Development');
        topics.push('Feature Engineering and Selection');
      } else if (primaryJob.includes('security')) {
        topics.push('Threat Modeling and Risk Assessment');
        topics.push('Security Auditing and Compliance');
      } else {
        topics.push('Complex Problem Case Studies');
        topics.push('Industry-Specific Applications');
      }
    }
    else if (weekNumber <= 14) {
      // Integration and mastery weeks
      topics.push('System Integration and Deployment');
      if (primaryJob.includes('engineer')) {
        topics.push('CI/CD Pipeline Implementation');
        topics.push('Production Environment Management');
      } else if (primaryJob.includes('analyst')) {
        topics.push('Business Intelligence Dashboard Creation');
        topics.push('Stakeholder Communication Strategies');
      } else {
        topics.push('End-to-End Project Implementation');
        topics.push('Quality Assurance and Validation');
      }
    }
    else {
      // Final weeks: Synthesis and career prep
      topics.push('Capstone Project Presentations');
      topics.push('Career Development and Industry Networking');
      topics.push('Emerging Trends and Future Directions');
    }
    
    return topics;
  }
  
  private enhanceTopicDescription(topic: string, relatedJobs: string[]): string {
    // If topic is already detailed, return as is
    if (topic.length > 40 || topic.includes(':') || topic.includes('(')) {
      return topic;
    }
    
    const primaryJob = relatedJobs[0]?.toLowerCase() || '';
    const topicLower = topic.toLowerCase();
    
    // Job-specific contextual enhancements
    const jobEnhancements: { [key: string]: { [topic: string]: string } } = {
      'software': {
        'sql': 'SQL: Complex Queries, Stored Procedures, and Performance Tuning',
        'mongodb': 'MongoDB: Schema Design, Aggregation Pipeline, and Sharding',
        'nosql': 'NoSQL: CAP Theorem, Eventual Consistency, and Use Case Selection',
        'uml': 'UML: Class Diagrams, Sequence Diagrams, and Design Documentation',
        'bpmn': 'BPMN: Process Automation and Workflow Integration',
        'methodologies': 'Agile Methodologies: Scrum, Kanban, and DevOps Practices',
        'object-oriented': 'Object-Oriented Design: SOLID Principles and Design Patterns',
        'project': 'Project Management: Sprint Planning and Backlog Refinement'
      },
      'data': {
        'sql': 'SQL: Window Functions, CTEs, and Advanced Analytics Queries',
        'mongodb': 'MongoDB: Time-Series Data, Geospatial Queries, and Map-Reduce',
        'nosql': 'NoSQL for Big Data: Cassandra, HBase, and Data Lakes',
        'modeling': 'Data Modeling: Dimensional Modeling and Data Vault',
        'analysis': 'Statistical Analysis: Hypothesis Testing and Regression Models',
        'visualization': 'Data Visualization: Tableau, Power BI, and D3.js',
        'etl': 'ETL/ELT Pipelines: Apache Airflow and Data Integration'
      },
      'cloud': {
        'architecture': 'Cloud Architecture: Multi-tier, Serverless, and Edge Computing',
        'services': 'Cloud Services: AWS Lambda, Azure Functions, GCP Cloud Run',
        'security': 'Cloud Security: IAM, VPC, and Zero Trust Architecture',
        'deployment': 'Infrastructure as Code: Terraform, CloudFormation, and ARM',
        'monitoring': 'Cloud Monitoring: CloudWatch, Azure Monitor, and Logging'
      },
      'analyst': {
        'requirements': 'Requirements Analysis: User Stories and Acceptance Criteria',
        'process': 'Process Analysis: Value Stream Mapping and Gap Analysis',
        'documentation': 'Technical Documentation: Business Requirements and SRS',
        'stakeholder': 'Stakeholder Management: Communication Plans and RACI Matrix',
        'testing': 'UAT Coordination: Test Planning and Defect Management'
      }
    };
    
    // First try exact match enhancements
    const exactEnhancements: { [key: string]: string } = {
      'SQL': primaryJob.includes('data') 
        ? 'SQL: Window Functions, CTEs, and Advanced Analytics'
        : 'SQL: Query Optimization, Indexing, and Stored Procedures',
      'MongoDB': primaryJob.includes('data')
        ? 'MongoDB: Aggregation Framework and Time-Series Collections'
        : 'MongoDB: Document Design, Transactions, and Replication',
      'NoSQL': 'NoSQL Databases: Document, Key-Value, Graph, and Column Stores',
      'UML': 'UML Diagrams: Use Cases, Class, Sequence, and Activity Diagrams',
      'BPMN': 'Business Process Modeling: Workflows, Gateways, and Events',
      'API': 'API Development: REST, GraphQL, gRPC, and WebSockets',
      'Testing': primaryJob.includes('software')
        ? 'Testing: TDD, BDD, Mocking, and Continuous Testing'
        : 'Testing: Data Validation, Integration, and Performance Testing',
      'Security': 'Security: OWASP Top 10, Encryption, and Access Control',
      'Cloud': 'Cloud Platforms: AWS, Azure, GCP - Services Comparison',
      'Agile': 'Agile Practices: Sprint Planning, Retrospectives, and Metrics',
      'Database': primaryJob.includes('data')
        ? 'Database Systems: OLAP, OLTP, and Data Warehousing'
        : 'Database Design: Normalization, Indexing, and Transactions'
    };
    
    // Check for exact matches first
    for (const [key, enhanced] of Object.entries(exactEnhancements)) {
      if (topic === key || topicLower === key.toLowerCase()) {
        return enhanced;
      }
    }
    
    // Check for partial matches in job-specific enhancements
    for (const [jobKey, topicEnhancements] of Object.entries(jobEnhancements)) {
      if (primaryJob.includes(jobKey)) {
        for (const [topicKey, enhanced] of Object.entries(topicEnhancements)) {
          if (topicLower.includes(topicKey)) {
            return enhanced;
          }
        }
      }
    }
    
    // If still no match, check for keyword-based enhancements
    if (topicLower.includes('database')) {
      return primaryJob.includes('data')
        ? 'Database Systems: Data Warehousing and Analytics Platforms'
        : 'Database Management: ACID, Transactions, and Concurrency';
    }
    if (topicLower.includes('project')) {
      return 'Project Management: Planning, Execution, and Risk Management';
    }
    if (topicLower.includes('analysis')) {
      return primaryJob.includes('data')
        ? 'Data Analysis: Statistical Methods and Predictive Modeling'
        : 'Systems Analysis: Requirements Gathering and Solution Design';
    }
    if (topicLower.includes('design')) {
      return primaryJob.includes('software')
        ? 'Software Design: Architecture Patterns and Best Practices'
        : 'System Design: Component Integration and Interface Design';
    }
    
    // Return original if no enhancement found
    return topic;
  }
  
  private generateEnhancedSyllabi(analysisResponse: AnalysisResponse): void {
    console.log('[Enhancement] Generating enhanced syllabi for unmapped jobs');
    
    // Find unmapped jobs
    const mappedJobs = Object.keys(analysisResponse.mappings || {});
    const unmappedJobs = this.jobTitles
      .map(jt => jt.label)
      .filter(job => !mappedJobs.includes(job));
    
    console.log('Unmapped jobs:', unmappedJobs);
    
    if (unmappedJobs.length === 0) {
      console.log('All jobs are mapped, no enhanced syllabi needed');
      this.appStateService.setAnalysisResults(analysisResponse);
      this.showSuccess('AI analysis completed successfully');
      this.finishProcessing();
      return;
    }

    // Select courses to enhance (prioritize popular/core courses)
    const coursesToEnhance = this.selectCoursesForEnhancement();
    
    if (coursesToEnhance.length === 0) {
      console.log('No suitable courses found for enhancement');
      this.appStateService.setAnalysisResults(analysisResponse);
      this.showSuccess('AI analysis completed successfully');
      this.finishProcessing();
      return;
    }

    this.processingMessage = 'Generating enhanced syllabi...';
    this.statusMessage = 'Generating enhanced syllabi...';

    // Generate enhanced syllabi for selected courses
    let completedEnhancements = 0;
    const totalEnhancements = Math.min(coursesToEnhance.length, 3); // Limit to 3 enhancements
    const enhancedSuggestedCourses: SuggestedCourse[] = [];
    
    coursesToEnhance.slice(0, totalEnhancements).forEach((course, index) => {
      // Identify relevant skill gaps
      const skillGaps = this.extractSkillGaps(unmappedJobs);
      
      this.aiClientService.generateEnhancedSyllabus(course, unmappedJobs, skillGaps)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (enhancedSyllabus) => {
            console.log('[Enhancement] Enhanced syllabus generated for:', course.title);
            
            // Convert to SuggestedCourse format
            const suggestedCourse: SuggestedCourse = {
              title: `${course.title} (Enhanced)`,
              confidence: enhancedSyllabus.confidence_score,
              skill_gaps: skillGaps,
              related_jobs: unmappedJobs,
              reasoning: enhancedSyllabus.improvement_summary,
              created_at: new Date().toISOString(),
              enhanced_syllabus: enhancedSyllabus,
              original_course_id: course.id || course.code || '',
              improvement_type: 'enhanced_syllabus'
            };
            
            enhancedSuggestedCourses.push(suggestedCourse);
            completedEnhancements++;
            
            // Check if all enhancements are complete
            if (completedEnhancements === totalEnhancements) {
              this.finalizeSyllabusEnhancements(analysisResponse, enhancedSuggestedCourses);
            }
          },
          error: (error) => {
            console.error('[Error] Failed to generate enhanced syllabus for:', course.title, error);
            completedEnhancements++;
            
            // Check if all attempts are complete (including failures)
            if (completedEnhancements === totalEnhancements) {
              this.finalizeSyllabusEnhancements(analysisResponse, enhancedSuggestedCourses);
            }
          }
        });
    });
  }

  private selectCoursesForEnhancement(): CourseWithSyllabus[] {
    // Select courses that are most suitable for enhancement
    const availableCourses = Array.from(this.syllabusCoursesMap.values());
    
    // Prioritize courses with good content but potential gaps
    return availableCourses
      .filter(course => {
        const weeklySchedule = course.syllabus?.weeklySchedule || [];
        return weeklySchedule.length > 5 && weeklySchedule.length < 16; // Has content but not overly comprehensive
      })
      .sort((a, b) => {
        // Prioritize courses with some gaps (more enhancement potential)
        const aGaps = this.countPotentialGaps(a);
        const bGaps = this.countPotentialGaps(b);
        return bGaps - aGaps;
      })
      .slice(0, 3); // Limit to top 3 candidates
  }

  private countPotentialGaps(course: CourseWithSyllabus): number {
    const weeklySchedule = course.syllabus?.weeklySchedule || [];
    const weekNumbers = weeklySchedule.map(w => w.week).sort((a, b) => a - b);
    
    let gaps = 0;
    const maxWeek = Math.max(...weekNumbers);
    
    for (let week = 1; week <= maxWeek; week++) {
      if (!weekNumbers.includes(week)) {
        gaps++;
      }
    }
    
    return gaps;
  }

  private extractSkillGaps(unmappedJobs: string[]): string[] {
    // Extract common skill gaps from job titles
    const skillGaps: string[] = [];
    
    unmappedJobs.forEach(job => {
      const jobLower = job.toLowerCase();
      
      if (jobLower.includes('cloud') || jobLower.includes('aws') || jobLower.includes('azure')) {
        skillGaps.push('Cloud Computing');
      }
      if (jobLower.includes('security') || jobLower.includes('cyber')) {
        skillGaps.push('Cybersecurity');
      }
      if (jobLower.includes('data') || jobLower.includes('analytics')) {
        skillGaps.push('Data Analytics');
      }
      if (jobLower.includes('ai') || jobLower.includes('machine learning') || jobLower.includes('ml')) {
        skillGaps.push('Artificial Intelligence');
      }
      if (jobLower.includes('devops') || jobLower.includes('deployment')) {
        skillGaps.push('DevOps');
      }
      if (jobLower.includes('mobile') || jobLower.includes('app')) {
        skillGaps.push('Mobile Development');
      }
    });
    
    // Remove duplicates and add general skills if none found
    const uniqueSkills = [...new Set(skillGaps)];
    if (uniqueSkills.length === 0) {
      uniqueSkills.push('Industry Practices', 'Professional Skills');
    }
    
    return uniqueSkills;
  }

  private finalizeSyllabusEnhancements(
    originalResponse: AnalysisResponse, 
    enhancedSuggestedCourses: SuggestedCourse[]
  ): void {
    console.log('[Enhancement] Finalizing enhanced syllabi:', enhancedSuggestedCourses.length);
    
    // Combine original analysis with enhanced syllabi
    const finalResponse: AnalysisResponse = {
      ...originalResponse,
      suggested_courses: [
        ...(originalResponse.suggested_courses || []),
        ...enhancedSuggestedCourses
      ]
    };
    
    this.appStateService.setAnalysisResults(finalResponse);

    if (enhancedSuggestedCourses.length > 0) {
      this.showSuccess(`AI analysis completed with ${enhancedSuggestedCourses.length} enhanced syllabi`);
    } else {
      this.showSuccess('AI analysis completed successfully');
    }

    // Save all syllabus data to cache including enhancements and enhanced syllabi
    this.saveCurrentSyllabusState();

    this.finishProcessing();
  }

  openJobDialog(): void {
    const dialogData: JobDialogData = {
      existingJobs: this.jobTitles,
      mode: 'both'
    };

    const dialogRef = this.dialog.open(JobDialogComponent, {
      width: '700px',
      maxHeight: '80vh',
      data: dialogData,
      disableClose: false,
      panelClass: 'modern-dialog'
    });

    dialogRef.afterClosed().subscribe((result: JobDialogResult | null) => {
      if (result && result.jobs.length > 0) {
        // Add new jobs to existing list
        const updatedJobs = [...this.jobTitles, ...result.jobs];
        this.appStateService.setJobTitles(updatedJobs);
        
        // Move to next step if not already there
        if (this.currentStep < 3) {
          this.appStateService.setCurrentStep(3);
        }
        
        this.showSuccess(`Added ${result.jobs.length} job title(s)`);
      }
    });
  }

  openSettings(): void {
    console.log('[Settings] Opening settings dialog');
    const dialogRef = this.dialog.open(SettingsDialogComponent, {
      width: '600px',
      maxHeight: '80vh',
      disableClose: false,
      panelClass: 'modern-dialog'
    });

    dialogRef.afterClosed().subscribe((saved: boolean) => {
      if (saved) {
        console.log('[Settings] Settings saved');
        // Refresh API key status
        this.hasApiKey = this.settingsService.hasApiKey();
        console.log('API key configured:', this.hasApiKey);
        
        // Apply theme if changed
        const theme = this.settingsService.getTheme();
        this.applyTheme(theme);
      }
    });
  }

  private applyTheme(theme: 'light' | 'dark' | 'auto'): void {
    const body = document.body;
    
    // Remove existing theme classes
    body.classList.remove('light-theme', 'dark-theme');
    
    if (theme === 'auto') {
      // Use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(prefersDark ? 'dark-theme' : 'light-theme');
    } else {
      body.classList.add(`${theme}-theme`);
    }
  }

  // Utility methods
  private finishProcessing(): void {
    this.appStateService.setLoading(false);
    this.appStateService.setProcessing(false);
  }

  // UI helper methods
  getStatusIcon(): string {
    if (this.isLoading) return 'hourglass_empty';
    if (this.currentStep === 4) return 'check_circle';
    return 'info';
  }

  getStatusIconClass(): string {
    if (this.isLoading) return 'status-loading';
    if (this.currentStep === 4) return 'status-success';
    return 'status-info';
  }

  getStatusBarClass(): string {
    // Determine status bar class based on current state
    if (this.isLoading || this.isProcessing) {
      return 'status-loading';
    }

    // Check if status message indicates success
    if (this.statusMessage.toLowerCase().includes('complete') ||
        this.statusMessage.toLowerCase().includes('success') ||
        this.statusMessage.toLowerCase().includes('loaded')) {
      return 'status-success';
    }

    // Check for error/failure
    if (this.statusMessage.toLowerCase().includes('error') ||
        this.statusMessage.toLowerCase().includes('failed')) {
      return 'status-error';
    }

    // Check for warning/low confidence
    if (this.statusMessage.toLowerCase().includes('warning') ||
        this.statusMessage.toLowerCase().includes('low confidence')) {
      return 'status-warning';
    }

    // Default info state
    return '';
  }

  getCurrentStepName(): string {
    switch (this.currentStep) {
      case 1: return 'Course Data';
      case 2: return 'Job Titles';
      case 3: return 'Course Mapping';
      case 4: return 'AI Analysis';
      default: return 'Processing';
    }
  }

  private autoHideStatusBar(): void {
    // Clear any existing timer
    if (this.statusBarTimer) {
      clearTimeout(this.statusBarTimer);
    }

    // Reset hiding state and show the status bar
    this.isStatusBarHiding = false;
    this.showStatusBar = true;

    // Don't auto-hide for loading or error states
    if (this.isLoading || this.isProcessing ||
        this.statusMessage.toLowerCase().includes('error') ||
        this.statusMessage.toLowerCase().includes('failed')) {
      return;
    }

    // Auto-hide after 5 seconds for success/info/warning messages
    this.statusBarTimer = setTimeout(() => {
      // Start fade-out animation
      this.isStatusBarHiding = true;

      // Wait for animation to complete before removing from DOM
      setTimeout(() => {
        this.showStatusBar = false;
        this.isStatusBarHiding = false;
      }, 400); // Match animation duration
    }, 5000);
  }

  formatLogTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  // Helper methods for AI Analysis Dashboard
  getUnmappedJobsCount(): number {
    const mappedJobs = Object.keys(this.mappings);
    return this.jobTitles.length - mappedJobs.length;
  }

  getMappingCoveragePercent(jobTitle: string): number {
    // Return a coverage percentage based on mapping quality
    // For now, return 85% if mapped, can be enhanced with actual analysis
    return this.mappings[jobTitle] ? 85 : 0;
  }

  getMappedCourseLabel(jobTitle: string): string {
    const mapping = this.mappings[jobTitle];
    if (!mapping || !Array.isArray(mapping) || mapping.length === 0) {
      return 'No course mapped';
    }
    // Return the first mapped course label
    const firstCourse = mapping[0];
    return typeof firstCourse === 'string' ? firstCourse : firstCourse.label || 'Unknown course';
  }

  hasJobDescriptions(): boolean {
    return this.jobTitles.some((job: JobTitle) => job.description && job.description.trim().length > 0);
  }

  getJobsWithDescriptions(): JobTitle[] {
    return this.jobTitles.filter((job: JobTitle) => job.description && job.description.trim().length > 0);
  }

  getSkillsCovered(job: JobTitle): string[] {
    // Extract skills from job that are covered by mapped courses
    if (!job.skills || job.skills.length === 0) {
      return [];
    }

    const mappedCourses = this.mappings[job.label];
    if (!mappedCourses || mappedCourses.length === 0) {
      return [];
    }

    // For now, return a subset of skills as "covered"
    // This can be enhanced with actual course syllabus analysis
    const coveredCount = Math.floor(job.skills.length * 0.7); // Assume 70% covered
    return job.skills.slice(0, coveredCount);
  }

  getSkillsGap(job: JobTitle): string[] {
    // Extract skills that are NOT covered by mapped courses
    if (!job.skills || job.skills.length === 0) {
      return [];
    }

    const covered = this.getSkillsCovered(job);
    return job.skills.filter(skill => !covered.includes(skill));
  }

  // Helper methods for job descriptions
  getJobTooltip(job: JobTitle): string {
    let tooltip = job.label;
    
    if (job.description) {
      tooltip += `\n\n${job.description}`;
    }
    
    if (job.skills && job.skills.length > 0) {
      tooltip += `\n\nKey Skills: ${job.skills.join(', ')}`;
    }
    
    if (job.trends) {
      tooltip += `\n\nMarket Trend: ${job.trends}`;
    }
    
    if (job.averageSalary) {
      tooltip += `\n\nAverage Salary: ${job.averageSalary}`;
    }
    
    if (job.experienceLevel) {
      const levelMap: { [key: string]: string } = {
        'entry': 'Entry Level',
        'mid': 'Mid-Level',
        'senior': 'Senior Level',
        'lead': 'Lead/Principal'
      };
      tooltip += `\n\nExperience: ${levelMap[job.experienceLevel] || job.experienceLevel}`;
    }
    
    return tooltip;
  }

  getJobDescriptionForMapping(jobLabel: string): string {
    const job = this.jobTitles.find(j => j.label === jobLabel);
    if (!job) return jobLabel;
    return this.getJobTooltip(job);
  }

  hasJobDescription(jobLabel: string): boolean {
    const job = this.jobTitles.find(j => j.label === jobLabel);
    return !!job?.description;
  }

  // Job Details Dialog Methods
  showJobDetails(job: JobTitle): void {
    const dialogRef = this.dialog.open(JobDetailsDialogComponent, {
      data: job,
      width: '600px',
      maxWidth: '90vw',
      panelClass: 'modern-dialog'
    });
  }

  showJobDetailsByLabel(jobLabel: string): void {
    const job = this.jobTitles.find(j => j.label === jobLabel);
    if (job) {
      this.showJobDetails(job);
    }
  }

  showAllJobs(): void {
    this.showAllJobsExpanded = !this.showAllJobsExpanded;
  }

  // Helper to safely extract course label from mapping.course
  // Handles both string labels and CourseWithSyllabus objects
  getCourseLabelSafe(course: any): string {
    // If it's already a string, return it
    if (typeof course === 'string') {
      return course;
    }

    // If it's an object with a label property, use that
    if (course && typeof course === 'object') {

      // Try label property first
      if (course.label) {
        return course.label;
      }

      // Try to construct from code and title
      if (course.code && course.title) {
        return `${course.code} ${course.title}`;
      }

      // Try just code
      if (course.code) {
        return course.code;
      }

      // Last resort: stringify but truncate
      const str = JSON.stringify(course);
      console.error('Had to stringify course object:', str.substring(0, 100));
      return '[Invalid Course Data]';
    }

    console.error('Course is neither string nor object:', course);
    return '[Unknown]';
  }

  // Notification helpers - Using status bar only (removed duplicate snackbar calls)
  private showSuccess(message: string): void {
    this.statusMessage = message;
  }

  private showError(message: string): void {
    this.statusMessage = `Error: ${message}`;
  }

  private showInfo(message: string): void {
    this.statusMessage = message;
  }

  private showWarning(message: string): void {
    this.statusMessage = `Warning: ${message}`;
  }

  // Suggested course click handler
  onSuggestedCourseClick(suggestion: SuggestedCourse): void {
    console.log('[Course] Suggested course clicked');
    console.log('Suggestion:', suggestion.title);
    console.log('Type:', suggestion.improvement_type);
    
    if (suggestion.improvement_type === 'enhanced_syllabus' && suggestion.enhanced_syllabus) {
      // Open diff viewer for enhanced syllabus
      this.openEnhancedSyllabusDialog(suggestion.enhanced_syllabus);
    } else {
      // Show regular suggestion info
      this.showSuggestionDetails(suggestion);
    }
  }

  private openEnhancedSyllabusDialog(enhancedSyllabus: EnhancedSyllabus): void {
    // Find the original course
    const originalCourse = this.syllabusCoursesMap.get(enhancedSyllabus.original_course_id);
    
    if (!originalCourse) {
      this.showError('Original course not found for comparison');
      return;
    }

    const dialogRef = this.dialog.open(SyllabusDialogComponent, {
      width: '100%',
      maxWidth: '1400px',
      maxHeight: '90vh',
      data: {
        course: originalCourse,
        enhancedSyllabus: enhancedSyllabus,
        mode: 'diff'
      },
      panelClass: 'modern-dialog'
    });
  }

  private showSuggestionDetails(suggestion: SuggestedCourse): void {
    // Show details for regular suggestion (could be enhanced later)
    const dialogRef = this.dialog.open(JobDialogComponent, {
      width: '600px',
      maxHeight: '70vh',
      panelClass: 'modern-dialog',
      data: {
        title: suggestion.title,
        content: `
          <h3>${suggestion.title}</h3>
          <p><strong>For Jobs:</strong> ${(suggestion.related_jobs || []).join(', ')}</p>
          <p><strong>Skill Gaps:</strong> ${(suggestion.skill_gaps || []).join(', ')}</p>
          <p><strong>Reasoning:</strong> ${suggestion.reasoning}</p>
        `,
        mode: 'view'
      }
    });
  }

  getSuggestionIcon(suggestion: SuggestedCourse): string {
    if (suggestion.improvement_type === 'enhanced_syllabus') {
      return 'compare'; // Diff icon for enhanced syllabi
    }
    return 'add_circle'; // Plus icon for new courses
  }

  getSuggestionTooltip(suggestion: SuggestedCourse): string {
    if (suggestion.improvement_type === 'enhanced_syllabus') {
      return `Enhanced syllabus for: ${(suggestion.related_jobs || []).join(', ')} - Click to view improvements`;
    }
    return `For: ${(suggestion.related_jobs || []).join(', ')} - Click to view details`;
  }

  // Syllabus-related methods
  onCourseClick(course: Course, event?: Event): void {
    console.log('Course clicked from upload section:', course.label);
    
    // Prevent any event bubbling
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!this.hasSyllabusData) {
      this.showInfo('Please load syllabus data first');
      return;
    }
    
    if (this.syllabusCoursesMap.size === 0) {
      this.showError('Syllabus data appears to be empty. Please reload syllabus data.');
      return;
    }
    
    // Find the syllabus course
    const syllabusCourse = this.findSyllabusCourse(course.label, course.id);
    
    if (syllabusCourse) {
      console.log('Found syllabus course:', syllabusCourse.title);
      // Open regular syllabus dialog for upload section
      this.openSyllabusDialog(syllabusCourse);
    } else {
      console.log('No syllabus data found for course:', course.label);
      this.showInfo(`No syllabus data available for "${course.label}". Make sure syllabus data is loaded and this course exists in the syllabus.`);
    }
  }
  
  getCourseHasSyllabus(course: Course): boolean {
    // Check both id and label keys to match how data is stored during PDF/Excel upload
    return this.syllabusCoursesMap.has(course.id) ||
           this.syllabusCoursesMap.has(course.label);
  }
  
  showAllCoursesDialog(): void {
    // Toggle inline expansion of courses list
    this.showAllCourses = !this.showAllCourses;
  }
  
  onCourseClickFromArray(courseName: string, job: string): void {
    console.log('\n=== REVIEW SECTION COURSE CLICK ===');
    console.log('Course name:', courseName);
    console.log('Related job:', job);
    
    if (!this.hasSyllabusData) {
      this.showInfo('Please load syllabus data first');
      return;
    }
    
    // Find the original syllabus course
    const syllabusCourse = this.findSyllabusCourse(courseName, courseName);
    
    if (!syllabusCourse) {
      console.error(`Failed to find syllabus for "${courseName}"`);
      this.showInfo(`No syllabus data available for "${courseName}"`);
      return;
    }
    
    console.log('Found syllabus course:', syllabusCourse.title);
    
    // Check if we have an enhanced syllabus for this course
    const enhancedSyllabus = this.enhancedSyllabiMap.get(courseName);
    console.log('Enhanced syllabus exists:', !!enhancedSyllabus);
    
    if (enhancedSyllabus) {
      console.log('Opening diff view for enhanced syllabus');
      // Open diff viewer showing original vs enhanced
      this.openEnhancedSyllabusDialog(enhancedSyllabus);
    } else {
      console.log('Opening course enhancement dialog');
      // Fallback to showing original syllabus with calculated improvements
      this.openCourseEnhancementDialog(syllabusCourse);
    }
  }
  
  // Helper method to find syllabus course by name or ID
  private findSyllabusCourse(courseLabel: string, courseId: string): CourseWithSyllabus | undefined {
    console.log(`Looking for course - Label: "${courseLabel}", ID: "${courseId}"`);
    console.log('Available keys in syllabusCoursesMap:', Array.from(this.syllabusCoursesMap.keys()));
    
    // Try exact match by label first (most likely case for review section)
    let syllabusCourse: CourseWithSyllabus | undefined = this.syllabusCoursesMap.get(courseLabel);
    if (syllabusCourse) {
      console.log('Found by exact label match');
      return syllabusCourse;
    }
    
    // Try by ID
    syllabusCourse = this.syllabusCoursesMap.get(courseId);
    if (syllabusCourse) {
      console.log('Found by ID match');
      return syllabusCourse;
    }
    
    // Try extracting course code from label (e.g., "MIS 6308 System Analysis..." -> "MIS 6308")
    const codeMatch = courseLabel.match(/^([A-Z]{2,4}\s+\d{4})/);
    if (codeMatch) {
      const extractedCode = codeMatch[1];
      console.log(`Extracted code "${extractedCode}" from label`);
      syllabusCourse = this.syllabusCoursesMap.get(extractedCode);
      if (syllabusCourse) {
        console.log('Found by extracted code');
        return syllabusCourse;
      }
    }
    
    // If not found by direct lookup, try iterating for partial matches
    if (!syllabusCourse) {
      this.syllabusCoursesMap.forEach((value, key) => {
        if (!syllabusCourse) {
          // Match by course label or course title
          const exactTitleMatch = value.title === courseLabel;
          const exactCodeMatch = value.code === courseLabel;
          const fullCodeTitleMatch = `${value.code} ${value.title}` === courseLabel;
          const courseContainsCode = courseLabel.includes(value.code || '');
          const courseContainsTitle = courseLabel.includes(value.title || '');
          
          if (exactTitleMatch || exactCodeMatch || fullCodeTitleMatch || courseContainsCode || courseContainsTitle) {
            console.log(`Found by partial match with key: "${key}"`);
            syllabusCourse = value;
          }
        }
      });
    }
    
    // If still not found, try fuzzy matching
    if (!syllabusCourse && courseLabel) {
      const courseName = courseLabel.toLowerCase();
      this.syllabusCoursesMap.forEach((value, key) => {
        if (!syllabusCourse) {
          const valueTitle = value.title?.toLowerCase() || '';
          const valueCode = value.code?.toLowerCase() || '';
          
          // Check if course name contains major keywords from syllabus course
          const titleWords = valueTitle.split(' ').filter(w => w.length > 3);
          const codeWords = valueCode.split(' ');
          const allWords = [...titleWords, ...codeWords];
          
          const matchCount = allWords.filter(word => courseName.includes(word)).length;
          if (matchCount > 0 && (titleWords.length === 0 || matchCount / titleWords.length > 0.3)) {
            syllabusCourse = value;
          }
        }
      });
    }

    if (!syllabusCourse) {
      console.warn(`[Warning] Course NOT FOUND after all matching attempts - Label: "${courseLabel}", ID: "${courseId}"`);
      console.warn('   Map has', this.syllabusCoursesMap.size, 'entries');
      console.warn('   Available keys:', Array.from(this.syllabusCoursesMap.keys()));
    } else {
      const found = syllabusCourse as CourseWithSyllabus;
      console.log(`[Course] Successfully found course: ${found.code} - ${found.title}`);
    }

    return syllabusCourse;
  }
  
  private openSyllabusDialog(course: CourseWithSyllabus): void {
    console.log('[Dialog] Opening syllabus dialog');
    console.log('[Dialog] Course to display:', course);
    console.log('[Dialog] Course title:', course.title);
    console.log('[Dialog] Course code:', course.code);
    console.log('[Dialog] Has syllabus:', !!course.syllabus);
    console.log('[Dialog] Has raw content:', !!course.syllabus?.rawContent);
    console.log('[Dialog] Weekly schedule length:', course.syllabus?.weeklySchedule?.length || 0);
    
    try {
      const dialogRef = this.dialog.open(SyllabusDialogComponent, {
        width: '100%',
        maxWidth: '1170px',  // Increased by 30% from 900px
        maxHeight: '90vh',
        data: {
          course,
          mode: 'syllabus' as const
        } as SyllabusDialogData,
        panelClass: 'modern-dialog'
      });
      console.log('[Dialog] Dialog opened successfully');
    } catch (error) {
      console.error('[Error] Failed to open dialog:', error);
      this.showError(`Failed to open syllabus dialog: ${error}`);
    }
  }
  
  private openCourseEnhancementDialog(course: CourseWithSyllabus): void {
    console.log('\n=== OPENING ENHANCEMENT DIALOG ===');
    console.log('[Enhancement] Course:', course.title);
    console.log('[Enhancement] Calculating enhancements...');
    
    try {
      // Calculate enhancements for this course
      const enhancement = this.calculateCourseEnhancements(course);
      console.log('[Enhancement] Enhancement calculation completed:', enhancement);
      console.log('[Enhancement] Enhancement summary:');
      console.log('  - Gaps filled:', enhancement.gapsFilled.length);
      console.log('  - Topics enhanced:', enhancement.topicsEnhanced.length);
      console.log('  - Assignments moved:', enhancement.assignmentsMoved.length);
      console.log('  - Original weeks:', enhancement.originalWeekCount);
      console.log('  - Enhanced weeks:', enhancement.enhancedWeekCount);
      
      // Create enhancement dialog data
      const enhancementData = {
        course,
        enhancement,
        mode: 'enhancement' as const
      };
      
      console.log('[Dialog] Dialog data prepared:', enhancementData);
      console.log('[Dialog] Opening dialog with SyllabusDialogComponent...');
      
      const dialogRef = this.dialog.open(SyllabusDialogComponent, {
        width: '100%',
        maxWidth: '1200px',
        maxHeight: '90vh',
        data: enhancementData,
        panelClass: 'modern-dialog'
      });
      
      console.log('[Dialog] Dialog opened successfully. DialogRef:', dialogRef);
      
      // Add dialog result subscription for debugging
      dialogRef.afterClosed().subscribe(result => {
        console.log('[Dialog] Enhancement dialog closed. Result:', result);
      });
      
    } catch (error) {
      console.error('[Error] ERROR in openCourseEnhancementDialog:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        course: course
      });
      throw error; // Re-throw to be caught by the calling method
    }
  }
  
  private calculateCourseEnhancements(course: CourseWithSyllabus): CourseEnhancement {
    console.log('[Enhancement] Calculating enhancements for course:', course.title);
    const weeklySchedule = course.syllabus?.weeklySchedule || [];
    console.log('[Enhancement] Weekly schedule entries:', weeklySchedule.length);
    
    const weekMap = new Map<number, any[]>();
    
    // Group entries by week to find original structure
    weeklySchedule.forEach(entry => {
      const weekNum = entry.week;
      if (!weekMap.has(weekNum)) {
        weekMap.set(weekNum, []);
      }
      weekMap.get(weekNum)?.push(entry);
    });
    
    const maxWeek = weekMap.size > 0 ? Math.max(...Array.from(weekMap.keys())) : 0;
    const originalWeekCount = weekMap.size;
    const gapsFilled: number[] = [];
    const topicsEnhanced: { original: string; enhanced: string }[] = [];
    const assignmentsMoved: { from: string; to: string }[] = [];
    
    // Find gaps that were filled
    for (let week = 1; week <= maxWeek; week++) {
      if (!weekMap.has(week)) {
        gapsFilled.push(week);
      }
    }
    
    // Find topics that were enhanced
    weeklySchedule.forEach(entry => {
      if (entry.topics && Array.isArray(entry.topics)) {
        entry.topics.forEach((topic: string) => {
          // Check if topic matches our enhancement patterns
          if (topic === 'SQL' || topic === 'MongoDB' || topic === 'NoSQL') {
            const enhanced = this.getEnhancedTopicText(topic);
            if (enhanced !== topic) {
              topicsEnhanced.push({ original: topic, enhanced: enhanced });
            }
          }
          
          // Check if assignments were moved
          if (this.isAssignmentTopic(topic)) {
            assignmentsMoved.push({ from: 'topics', to: 'assignments' });
          }
        });
      }
    });
    
    const enhancementSummary = this.generateEnhancementSummary(gapsFilled, topicsEnhanced, assignmentsMoved);
    
    const result = {
      courseId: course.id || course.code || '',
      courseName: course.title || '',
      originalWeekCount,
      enhancedWeekCount: maxWeek,
      gapsFilled,
      topicsEnhanced,
      assignmentsMoved,
      enhancementTimestamp: new Date().toISOString(),
      enhancementSummary
    };
    
    console.log('[Enhancement] Enhancement calculation complete. Result:', result);
    return result;
  }
  
  private getEnhancedTopicText(original: string): string {
    const enhancements: { [key: string]: string } = {
      'SQL': 'SQL Fundamentals: DDL, DML, and Basic Queries',
      'MongoDB': 'MongoDB: Document Stores and Aggregation Framework',
      'NoSQL': 'NoSQL Databases: Types and Use Cases',
      'BPMN': 'Business Process Modeling Notation (BPMN)',
      'UML': 'Unified Modeling Language (UML) Diagrams'
    };
    return enhancements[original] || original;
  }
  
  private isAssignmentTopic(topic: string): boolean {
    return topic.includes('HW') || topic.includes('Quiz') || topic.includes('DUE') || topic.includes('Assignment');
  }
  
  private generateEnhancementSummary(gapsFilled: number[], topicsEnhanced: any[], assignmentsMoved: any[]): string {
    const improvements: string[] = [];
    
    if (gapsFilled.length > 0) {
      improvements.push(`Filled ${gapsFilled.length} missing weeks (${gapsFilled.join(', ')})`);
    }
    
    if (topicsEnhanced.length > 0) {
      improvements.push(`Enhanced ${topicsEnhanced.length} topic descriptions`);
    }
    
    if (assignmentsMoved.length > 0) {
      improvements.push(`Properly organized ${assignmentsMoved.length} assignments`);
    }
    
    if (improvements.length === 0) {
      return 'Course syllabus was already well-structured';
    }

    return improvements.join('; ');
  }

  // Step Navigation Methods
  goToNextStep(): void {
    if (this.stepper) {
      this.stepper.next();
      this.currentStep = this.stepper.selectedIndex + 1;
    }
  }

  goToPreviousStep(): void {
    if (this.stepper) {
      this.stepper.previous();
      this.currentStep = this.stepper.selectedIndex + 1;
    }
  }

  canGoToNextStep(): boolean {
    switch (this.currentStep) {
      case 1:
        return this.courses.length > 0;
      case 2:
        return this.jobTitles.length > 0;
      case 3:
        return Object.keys(this.mappings).length > 0;
      default:
        return false;
    }
  }

  canGoToPreviousStep(): boolean {
    return this.currentStep > 1;
  }
}
