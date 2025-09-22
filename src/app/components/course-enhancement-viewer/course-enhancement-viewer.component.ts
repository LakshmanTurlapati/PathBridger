import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { CourseEnhancement } from '../../shared/interfaces/data-models';
import { CourseWithSyllabus } from '../../shared/interfaces/syllabus.models';

@Component({
  selector: 'app-course-enhancement-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatDividerModule,
    MatListModule
  ],
  templateUrl: './course-enhancement-viewer.component.html',
  styleUrls: ['./course-enhancement-viewer.component.scss']
})
export class CourseEnhancementViewerComponent {
  @Input() course: CourseWithSyllabus | null = null;
  @Input() enhancement: CourseEnhancement | undefined = undefined;

  getImprovementSummary(): string {
    if (!this.enhancement) return 'No improvements calculated';
    
    const improvements: string[] = [];
    
    if (this.enhancement.gapsFilled.length > 0) {
      improvements.push(`${this.enhancement.gapsFilled.length} week gaps filled`);
    }
    
    if (this.enhancement.topicsEnhanced.length > 0) {
      improvements.push(`${this.enhancement.topicsEnhanced.length} topics enhanced`);
    }
    
    if (this.enhancement.assignmentsMoved.length > 0) {
      improvements.push(`${this.enhancement.assignmentsMoved.length} assignments organized`);
    }
    
    if (improvements.length === 0) {
      return 'Course syllabus was already well-structured';
    }
    
    return improvements.join(', ');
  }

  getEnhancementIcon(type: 'gaps' | 'topics' | 'assignments'): string {
    const icons = {
      gaps: 'auto_fix_high',
      topics: 'lightbulb',
      assignments: 'assignment_turned_in'
    };
    return icons[type];
  }

  hasImprovements(): boolean {
    if (!this.enhancement) return false;
    return this.enhancement.gapsFilled.length > 0 || 
           this.enhancement.topicsEnhanced.length > 0 || 
           this.enhancement.assignmentsMoved.length > 0;
  }
}