import { Component, Input, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Import diff2html
import * as Diff2Html from 'diff2html';
import { diffLines, diffWords } from 'diff';

// Import jsPDF for PDF generation
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

import { CourseWithSyllabus } from '../../shared/interfaces/syllabus.models';
import { CourseEnhancement } from '../../shared/interfaces/data-models';

export interface SyllabusDiffData {
  original: CourseWithSyllabus;
  enhanced: CourseWithSyllabus;
  enhancement: CourseEnhancement;
}

@Component({
  selector: 'app-syllabus-diff-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatTooltipModule
  ],
  templateUrl: './syllabus-diff-viewer.html',
  styleUrl: './syllabus-diff-viewer.scss',
  encapsulation: ViewEncapsulation.None // Required for diff2html styles
})
export class SyllabusDiffViewer implements OnInit, OnDestroy {
  @Input() diffData: SyllabusDiffData | null = null;
  
  viewMode: 'unified' | 'side-by-side' = 'side-by-side';
  diffFormat: 'line' | 'word' = 'line';
  diffHtml: SafeHtml = '';
  
  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    if (this.diffData) {
      this.generateDiff();
    }
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  onViewModeChange(mode: 'unified' | 'side-by-side'): void {
    this.viewMode = mode;
    this.generateDiff();
  }

  onDiffFormatChange(format: 'line' | 'word'): void {
    this.diffFormat = format;
    this.generateDiff();
  }

  private generateDiff(): void {
    if (!this.diffData) return;

    try {
      const originalContent = this.extractSyllabusContent(this.diffData.original);
      const enhancedContent = this.extractSyllabusContent(this.diffData.enhanced);

      // Generate diff using the selected format
      let diffResult;
      if (this.diffFormat === 'word') {
        diffResult = diffWords(originalContent, enhancedContent);
      } else {
        diffResult = diffLines(originalContent, enhancedContent);
      }

      // Convert to unified diff format
      const unifiedDiff = this.createUnifiedDiff(originalContent, enhancedContent, diffResult);

      // Generate HTML using diff2html
      const diffHtml = Diff2Html.html(unifiedDiff, {
        drawFileList: false,
        outputFormat: this.viewMode === 'side-by-side' ? 'side-by-side' : 'line-by-line',
        matching: 'lines'
      });

      this.diffHtml = this.sanitizer.bypassSecurityTrustHtml(diffHtml);
    } catch (error) {
      console.error('Failed to generate diff:', error);
      this.diffHtml = this.sanitizer.bypassSecurityTrustHtml('<p class="error">Failed to generate diff view</p>');
    }
  }

  private extractSyllabusContent(course: CourseWithSyllabus): string {
    if (!course.syllabus?.weeklySchedule) {
      return 'No syllabus content available';
    }

    const lines: string[] = [];
    lines.push(`Course: ${course.title}`);
    lines.push(`Code: ${course.code || 'N/A'}`);
    lines.push('');
    lines.push('WEEKLY SCHEDULE');
    lines.push('================');
    lines.push('');

    // Sort schedule by week
    const sortedSchedule = [...course.syllabus.weeklySchedule].sort((a, b) => a.week - b.week);

    for (const week of sortedSchedule) {
      lines.push(`Week ${week.week}`);
      lines.push(`Date: ${week.date}`);
      lines.push(`Topics: ${Array.isArray(week.topics) ? week.topics.join(', ') : week.topics}`);
      if (week.assignments) {
        lines.push(`Assignments: ${week.assignments}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private createUnifiedDiff(oldContent: string, newContent: string, diffResult: any[]): string {
    const lines = [
      'diff --git a/original.txt b/enhanced.txt',
      'index 0000000..1111111 100644',
      '--- a/original.txt',
      '+++ b/enhanced.txt'
    ];

    let oldLineNum = 1;
    let newLineNum = 1;

    for (const part of diffResult) {
      if (part.added) {
        const addedLines = part.value.split('\n').filter((line: string) => line !== '');
        for (const line of addedLines) {
          lines.push(`+${line}`);
          newLineNum++;
        }
      } else if (part.removed) {
        const removedLines = part.value.split('\n').filter((line: string) => line !== '');
        for (const line of removedLines) {
          lines.push(`-${line}`);
          oldLineNum++;
        }
      } else {
        const unchangedLines = part.value.split('\n').filter((line: string) => line !== '');
        for (const line of unchangedLines) {
          lines.push(` ${line}`);
          oldLineNum++;
          newLineNum++;
        }
      }
    }

    return lines.join('\n');
  }

  getEnhancementSummary(): string {
    if (!this.diffData?.enhancement) return 'No enhancement data available';

    const improvements: string[] = [];
    
    if (this.diffData.enhancement.gapsFilled.length > 0) {
      improvements.push(`${this.diffData.enhancement.gapsFilled.length} week gaps filled`);
    }
    
    if (this.diffData.enhancement.topicsEnhanced.length > 0) {
      improvements.push(`${this.diffData.enhancement.topicsEnhanced.length} topics enhanced`);
    }
    
    if (this.diffData.enhancement.assignmentsMoved.length > 0) {
      improvements.push(`${this.diffData.enhancement.assignmentsMoved.length} assignments organized`);
    }
    
    return improvements.length > 0 ? improvements.join(', ') : 'No improvements detected';
  }

  getImprovementIcon(): string {
    if (!this.diffData?.enhancement) return 'info';
    
    const totalImprovements = 
      this.diffData.enhancement.gapsFilled.length +
      this.diffData.enhancement.topicsEnhanced.length +
      this.diffData.enhancement.assignmentsMoved.length;
    
    if (totalImprovements >= 5) return 'auto_awesome';
    if (totalImprovements >= 3) return 'thumb_up';
    if (totalImprovements >= 1) return 'edit';
    return 'info';
  }

  exportDiff(): void {
    if (!this.diffData) return;

    // Generate PDF from markdown content
    this.generatePDF(this.diffData.enhanced, this.diffData.enhancement);
  }
  
  private generateMarkdownContent(course: CourseWithSyllabus, enhancement?: CourseEnhancement): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`# ${course.title}`);
    lines.push('');
    lines.push(`**Course Code:** ${course.code || 'N/A'}`);
    lines.push(`**Category:** ${course.category || 'N/A'}`);
    lines.push('');
    
    // Enhancement Summary
    if (enhancement) {
      lines.push('## Enhancement Summary');
      lines.push('');
      
      if (enhancement.gapsFilled.length > 0) {
        lines.push(`- **Gaps Filled:** ${enhancement.gapsFilled.length} weeks (Weeks ${enhancement.gapsFilled.join(', ')})`);
      }
      if (enhancement.topicsEnhanced.length > 0) {
        lines.push(`- **Topics Enhanced:** ${enhancement.topicsEnhanced.length} topics`);
      }
      if (enhancement.assignmentsMoved.length > 0) {
        lines.push(`- **Assignments Organized:** ${enhancement.assignmentsMoved.length} items`);
      }
      lines.push(`- **Week Count:** ${enhancement.originalWeekCount} → ${enhancement.enhancedWeekCount}`);
      lines.push('');
    }
    
    // Weekly Schedule
    lines.push('## Weekly Schedule');
    lines.push('');
    
    if (course.syllabus?.weeklySchedule && course.syllabus.weeklySchedule.length > 0) {
      // Create markdown table
      lines.push('| Week | Date | Topics | Assignments |');
      lines.push('|------|------|--------|-------------|');
      
      // Sort schedule by week
      const sortedSchedule = [...course.syllabus.weeklySchedule].sort((a, b) => a.week - b.week);
      
      for (const week of sortedSchedule) {
        const topics = Array.isArray(week.topics) 
          ? week.topics.join('<br>• ') 
          : week.topics || '';
        const assignments = week.assignments || '-';
        
        // Escape pipe characters in content
        const escapedTopics = topics.replace(/\|/g, '\\|');
        const escapedAssignments = assignments.replace(/\|/g, '\\|');
        
        lines.push(`| ${week.week} | ${week.date} | ${escapedTopics ? '• ' + escapedTopics : '-'} | ${escapedAssignments} |`);
      }
      lines.push('');
    } else {
      lines.push('*No weekly schedule available*');
      lines.push('');
    }
    
    // Enhanced Topics Details
    if (enhancement && enhancement.topicsEnhanced.length > 0) {
      lines.push('## Enhanced Topics');
      lines.push('');
      
      enhancement.topicsEnhanced.forEach(topic => {
        lines.push(`- **${topic.original}** → ${topic.enhanced}`);
      });
      lines.push('');
    }
    
    // Key Topics
    if (course.syllabus?.keyTopics && course.syllabus.keyTopics.length > 0) {
      lines.push('## Key Topics Covered');
      lines.push('');
      course.syllabus.keyTopics.forEach(topic => {
        lines.push(`- ${topic}`);
      });
      lines.push('');
    }
    
    // Footer
    lines.push('---');
    lines.push(`*Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}*`);
    
    return lines.join('\n');
  }
  
  /**
   * Generate PDF from enhanced syllabus data
   */
  private generatePDF(course: CourseWithSyllabus, enhancement?: CourseEnhancement): void {
    // Create PDF with proper formatting
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    // PDF settings
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let yPosition = margin;
    const lineHeight = 7;
    const headingSize = 16;
    const subheadingSize = 14;
    const bodySize = 11;
    
    // Helper function to check if we need a new page
    const checkNewPage = (requiredSpace: number = 20) => {
      if (yPosition + requiredSpace > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
        return true;
      }
      return false;
    };
    
    // Helper function to add wrapped text
    const addWrappedText = (text: string, fontSize: number = bodySize, isBold: boolean = false) => {
      pdf.setFontSize(fontSize);
      if (isBold) {
        pdf.setFont('helvetica', 'bold');
      } else {
        pdf.setFont('helvetica', 'normal');
      }
      
      const lines = pdf.splitTextToSize(text, contentWidth);
      lines.forEach((line: string) => {
        checkNewPage(lineHeight);
        pdf.text(line, margin, yPosition);
        yPosition += lineHeight;
      });
    };
    
    // Add title
    pdf.setFontSize(headingSize);
    pdf.setFont('helvetica', 'bold');
    pdf.text(course.title, margin, yPosition);
    yPosition += lineHeight * 1.5;
    
    // Add course details
    pdf.setFontSize(bodySize);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Course Code: ${course.code || 'N/A'}`, margin, yPosition);
    yPosition += lineHeight;
    pdf.text(`Category: ${course.category || 'N/A'}`, margin, yPosition);
    yPosition += lineHeight * 2;
    
    // Add enhancement summary if available
    if (enhancement) {
      checkNewPage(40);
      pdf.setFontSize(subheadingSize);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Enhancement Summary', margin, yPosition);
      yPosition += lineHeight * 1.5;
      
      pdf.setFontSize(bodySize);
      pdf.setFont('helvetica', 'normal');
      
      if (enhancement.gapsFilled.length > 0) {
        const text = `• Gaps Filled: ${enhancement.gapsFilled.length} weeks (Weeks ${enhancement.gapsFilled.join(', ')})`;
        addWrappedText(text);
      }
      
      if (enhancement.topicsEnhanced.length > 0) {
        addWrappedText(`• Topics Enhanced: ${enhancement.topicsEnhanced.length} topics`);
      }
      
      if (enhancement.assignmentsMoved.length > 0) {
        addWrappedText(`• Assignments Organized: ${enhancement.assignmentsMoved.length} items`);
      }
      
      addWrappedText(`• Week Count: ${enhancement.originalWeekCount} → ${enhancement.enhancedWeekCount}`);
      yPosition += lineHeight;
    }
    
    // Add weekly schedule
    checkNewPage(40);
    pdf.setFontSize(subheadingSize);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Weekly Schedule', margin, yPosition);
    yPosition += lineHeight * 1.5;
    
    if (course.syllabus?.weeklySchedule && course.syllabus.weeklySchedule.length > 0) {
      const sortedSchedule = [...course.syllabus.weeklySchedule].sort((a, b) => a.week - b.week);
      
      sortedSchedule.forEach(week => {
        checkNewPage(30);
        
        // Week header
        pdf.setFontSize(bodySize);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Week ${week.week} - ${week.date}`, margin, yPosition);
        yPosition += lineHeight;
        
        // Topics
        pdf.setFont('helvetica', 'normal');
        const topics = Array.isArray(week.topics) ? week.topics : [week.topics || 'No topics listed'];
        pdf.text('Topics:', margin, yPosition);
        yPosition += lineHeight;
        
        topics.forEach((topic: string) => {
          if (topic) {
            addWrappedText(`  • ${topic}`);
          }
        });
        
        // Assignments
        if (week.assignments) {
          pdf.text('Assignments:', margin, yPosition);
          yPosition += lineHeight;
          addWrappedText(`  ${week.assignments}`);
        }
        
        yPosition += lineHeight;
      });
    } else {
      pdf.setFont('helvetica', 'italic');
      pdf.text('No weekly schedule available', margin, yPosition);
      yPosition += lineHeight * 2;
    }
    
    // Add enhanced topics details
    if (enhancement && enhancement.topicsEnhanced.length > 0) {
      checkNewPage(40);
      pdf.setFontSize(subheadingSize);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Enhanced Topics', margin, yPosition);
      yPosition += lineHeight * 1.5;
      
      pdf.setFontSize(bodySize);
      pdf.setFont('helvetica', 'normal');
      
      enhancement.topicsEnhanced.forEach(topic => {
        checkNewPage(20);
        addWrappedText(`• ${topic.original} → ${topic.enhanced}`);
        yPosition += lineHeight * 0.5;
      });
      
      yPosition += lineHeight;
    }
    
    // Add key topics if available
    if (course.syllabus?.keyTopics && course.syllabus.keyTopics.length > 0) {
      checkNewPage(40);
      pdf.setFontSize(subheadingSize);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Key Topics Covered', margin, yPosition);
      yPosition += lineHeight * 1.5;
      
      pdf.setFontSize(bodySize);
      pdf.setFont('helvetica', 'normal');
      
      course.syllabus.keyTopics.forEach(topic => {
        checkNewPage(lineHeight);
        addWrappedText(`• ${topic}`);
      });
      
      yPosition += lineHeight;
    }
    
    // Add footer
    checkNewPage(20);
    yPosition = pageHeight - margin;
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(128, 128, 128);
    const timestamp = `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;
    pdf.text(timestamp, margin, yPosition);
    
    // Save the PDF
    pdf.save(`${course.code || 'course'}_enhanced_syllabus.pdf`);
  }
}
