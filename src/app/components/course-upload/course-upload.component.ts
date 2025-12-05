import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AppStateService } from '../../core/services/app-state.service';
import { ExcelParserService } from '../../core/services/excel-parser.service';
import { PdfParserService } from '../../core/services/pdf-parser.service';
import { NotificationService } from '../../core/services/notification.service';
import { Course } from '../../shared/interfaces/data-models';
import { CourseWithSyllabus } from '../../shared/interfaces/syllabus.models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';

@Component({
  selector: 'app-course-upload',
  templateUrl: './course-upload.component.html',
  styleUrls: ['./course-upload.component.scss'],
  standalone: false
})
export class CourseUploadComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  @Input() isLoading = false;
  @Input() hasSyllabusData = false;
  @Input() courses: Course[] = [];
  @Input() syllabusCoursesMap = new Map<string, CourseWithSyllabus>();

  @Output() fileSelected = new EventEmitter<File[]>();
  @Output() loadDefaultCoursesClick = new EventEmitter<void>();
  @Output() loadSampleSyllabusClick = new EventEmitter<void>();
  @Output() clearSyllabusCacheClick = new EventEmitter<void>();
  @Output() courseClick = new EventEmitter<{ course: Course; event: MouseEvent }>();
  @Output() showAllCoursesClick = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  constructor(
    private appStateService: AppStateService,
    private excelParserService: ExcelParserService,
    private pdfParserService: PdfParserService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    // Component initialization
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Trigger file upload dialog
   */
  triggerFileUpload(): void {
    this.fileInput.nativeElement.click();
  }

  /**
   * Handle file selection
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) return;

    // Convert FileList to Array
    const fileArray = Array.from(files);

    // Validate files
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

    // Validate: can't upload both types at once
    if (pdfFiles.length > 0 && excelFiles.length > 0) {
      this.notification.showError('Please upload either PDF files or Excel files, not both at the same time');
      return;
    }

    // Validate file sizes
    const maxSize = APP_CONSTANTS.FILE_LIMITS.MAX_SIZE_BYTES;
    for (const file of fileArray) {
      if (file.size > maxSize) {
        this.notification.showError(`File "${file.name}" exceeds the maximum size of ${APP_CONSTANTS.FILE_LIMITS.MAX_SIZE_MB}MB`);
        return;
      }
    }

    // Emit the files for processing
    this.fileSelected.emit(fileArray);

    // Reset the input
    input.value = '';
  }

  /**
   * Load default courses
   */
  loadDefaultCourses(): void {
    this.loadDefaultCoursesClick.emit();
  }

  /**
   * Load sample syllabus data
   */
  loadSampleSyllabus(): void {
    this.loadSampleSyllabusClick.emit();
  }

  /**
   * Clear syllabus cache
   */
  clearSyllabusCache(): void {
    this.clearSyllabusCacheClick.emit();
  }

  /**
   * Handle course click
   */
  onCourseClick(course: Course, event: MouseEvent): void {
    this.courseClick.emit({ course, event });
  }

  /**
   * Show all courses dialog
   */
  showAllCourses(): void {
    this.showAllCoursesClick.emit();
  }

  /**
   * Check if a course has syllabus data
   */
  getCourseHasSyllabus(course: Course): boolean {
    if (!course) return false;

    const courseId = course.id || course.label;
    return this.syllabusCoursesMap.has(courseId) ||
           this.syllabusCoursesMap.has(course.label);
  }

  /**
   * Get the number of courses with syllabus
   */
  get coursesWithSyllabusCount(): number {
    return this.syllabusCoursesMap.size;
  }

  /**
   * Get courses to display (limited)
   */
  get displayedCourses(): Course[] {
    return this.courses.slice(0, 5);
  }

  /**
   * Get remaining courses count
   */
  get remainingCoursesCount(): number {
    return Math.max(0, this.courses.length - 5);
  }

  /**
   * Check if there are more courses than displayed
   */
  get hasMoreCourses(): boolean {
    return this.courses.length > 5;
  }

  /**
   * Check if any courses are loaded
   */
  get hasCourses(): boolean {
    return this.courses.length > 0;
  }
}
