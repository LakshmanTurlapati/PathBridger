import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { CourseWithSyllabus } from '../../shared/interfaces/syllabus.models';
import { CourseEnhancement, EnhancedSyllabus } from '../../shared/interfaces/data-models';
import { SyllabusViewerComponent } from '../syllabus-viewer/syllabus-viewer.component';
import { CourseEnhancementViewerComponent } from '../course-enhancement-viewer/course-enhancement-viewer.component';
import { SyllabusDiffViewer, SyllabusDiffData } from '../syllabus-diff-viewer/syllabus-diff-viewer';

export interface SyllabusDialogData {
  course: CourseWithSyllabus;
  enhancement?: CourseEnhancement;
  enhancedSyllabus?: EnhancedSyllabus;
  mode?: 'syllabus' | 'enhancement' | 'diff';
}

@Component({
  selector: 'app-syllabus-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    SyllabusViewerComponent,
    CourseEnhancementViewerComponent,
    SyllabusDiffViewer
  ],
  templateUrl: './syllabus-dialog.component.html',
  styleUrls: ['./syllabus-dialog.component.scss']
})
export class SyllabusDialogComponent {
  
  constructor(
    public dialogRef: MatDialogRef<SyllabusDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SyllabusDialogData
  ) {}

  get isEnhancementMode(): boolean {
    return this.data.mode === 'enhancement';
  }

  get isDiffMode(): boolean {
    return this.data.mode === 'diff';
  }

  get isSyllabusMode(): boolean {
    return this.data.mode === 'syllabus' || !this.data.mode;
  }

  get dialogTitle(): string {
    if (this.isDiffMode) return 'Syllabus Enhancement Comparison';
    if (this.isEnhancementMode) return 'Course Improvements';
    return 'Course Syllabus';
  }

  get diffData(): SyllabusDiffData | null {
    if (!this.isDiffMode || !this.data.enhancedSyllabus) return null;
    
    return {
      original: this.data.course,
      enhanced: this.data.enhancedSyllabus.enhanced_course,
      enhancement: this.data.enhancedSyllabus.enhancement_details
    };
  }

  onClose(): void {
    this.dialogRef.close();
  }
}