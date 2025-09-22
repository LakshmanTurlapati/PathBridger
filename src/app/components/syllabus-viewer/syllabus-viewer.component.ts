import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CourseWithSyllabus, WeeklySchedule } from '../../shared/interfaces/syllabus.models';

@Component({
  selector: 'app-syllabus-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTabsModule,
    MatListModule,
    MatChipsModule,
    MatExpansionModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './syllabus-viewer.component.html',
  styleUrls: ['./syllabus-viewer.component.scss']
})
export class SyllabusViewerComponent implements OnInit {
  @Input() course: CourseWithSyllabus | null = null;
  @Input() expanded: boolean = false;
  
  selectedTabIndex = 0;
  searchTerm = '';
  filteredSchedule: WeeklySchedule[] = [];

  ngOnInit() {
    console.log('SyllabusViewerComponent initialized with course:', this.course);
    
    if (this.course) {
      console.log('Course data:', {
        id: this.course.id,
        title: this.course.title,
        hasSyllabus: !!this.course.syllabus,
        syllabusKeys: this.course.syllabus ? Object.keys(this.course.syllabus) : [],
        weeklyScheduleLength: this.course.syllabus?.weeklySchedule?.length || 0,
        keyTopicsLength: this.course.syllabus?.keyTopics?.length || 0
      });
      
      if (this.course.syllabus?.weeklySchedule) {
        this.filteredSchedule = [...this.course.syllabus.weeklySchedule];
        console.log('Weekly schedule loaded:', this.filteredSchedule.length, 'weeks');
      } else {
        console.warn('No weekly schedule found in course syllabus');
      }
      
      if (!this.course.syllabus) {
        console.error('Course has no syllabus data!');
      }
    } else {
      console.error('No course data provided to SyllabusViewerComponent');
    }
  }

  onSearchChange(term: string) {
    this.searchTerm = term;
    this.filterSchedule();
  }

  filterSchedule() {
    if (!this.course?.syllabus?.weeklySchedule) {
      this.filteredSchedule = [];
      return;
    }

    if (!this.searchTerm) {
      this.filteredSchedule = [...this.course.syllabus.weeklySchedule];
      return;
    }

    const searchLower = this.searchTerm.toLowerCase();
    this.filteredSchedule = this.course.syllabus.weeklySchedule.filter(week =>
      week.topics.some(topic => topic.toLowerCase().includes(searchLower)) ||
      week.assignments?.toLowerCase().includes(searchLower) ||
      week.date.toLowerCase().includes(searchLower)
    );
  }


  formatContent(content: string): string {
    console.log('\n=== formatContent DEBUG ===');
    console.log('Input type:', typeof content);
    console.log('Input length:', content?.length || 0);
    console.log('Input preview:', content?.substring(0, 100) || 'No content');
    
    if (!content) {
      return 'No syllabus content available';
    }
    
    // Return content as-is - no formatting to avoid any issues
    return content;
  }

  parseSyllabusTable(content: string): any[] {
    if (!content) return [];
    
    // Check if we have structured weeklySchedule data available
    if (this.course?.syllabus?.weeklySchedule && this.course.syllabus.weeklySchedule.length > 0) {
      return this.createTableFromStructuredData(this.course.syllabus.weeklySchedule);
    }
    
    // Otherwise parse the raw content and track enhancements
    return this.parseRawSyllabusContent(content);
  }
  
  private createTableFromStructuredData(weeklySchedule: any[]): any[] {
    const rows: any[] = [];
    const weekMap = new Map<number, any[]>();
    const enhancements = {
      gapsFilled: [] as number[],
      topicsEnhanced: [] as { original: string; enhanced: string }[],
      assignmentsMoved: [] as { from: string; to: string }[],
      originalWeekCount: 0,
      enhancedWeekCount: 0
    };
    
    // Group entries by week
    weeklySchedule.forEach(entry => {
      const weekNum = entry.week;
      if (!weekMap.has(weekNum)) {
        weekMap.set(weekNum, []);
      }
      weekMap.get(weekNum)?.push(entry);
    });
    
    // Find max week number and count original weeks
    const maxWeek = Math.max(...Array.from(weekMap.keys()));
    enhancements.originalWeekCount = weekMap.size;
    enhancements.enhancedWeekCount = maxWeek;
    
    // Create rows for all weeks, filling gaps
    for (let week = 1; week <= maxWeek; week++) {
      const weekEntries = weekMap.get(week);
      
      if (weekEntries && weekEntries.length > 0) {
        // Combine multiple entries for the same week
        const dates: string[] = [];
        const topics: string[] = [];
        const assignments: string[] = [];
        
        weekEntries.forEach(entry => {
          // Add date if it has a month
          if (entry.date && /(January|February|March|April|May|June|July|August|September|October|November|December)/i.test(entry.date)) {
            dates.push(entry.date);
          }
          
          // Process topics - move assignments to assignments column
          if (entry.topics && Array.isArray(entry.topics)) {
            entry.topics.forEach((topic: string) => {
              if (this.isAssignment(topic)) {
                assignments.push(topic);
                enhancements.assignmentsMoved.push({ from: 'topics', to: 'assignments' });
              } else {
                const enhanced = this.enhanceTopic(topic);
                if (enhanced !== topic) {
                  enhancements.topicsEnhanced.push({ original: topic, enhanced: enhanced });
                }
                topics.push(enhanced);
              }
            });
          }
          
          // Add actual assignments
          if (entry.assignments) {
            assignments.push(entry.assignments);
          }
        });
        
        rows.push({
          week: week.toString(),
          date: dates.join(', ') || `Week ${week}`,
          topics: topics.join('; ') || this.getDefaultTopicForWeek(week),
          assignments: assignments.join('; ') || '-'
        });
      } else {
        // Fill gap weeks
        enhancements.gapsFilled.push(week);
        rows.push({
          week: week.toString(),
          date: `Week ${week}`,
          topics: this.getDefaultTopicForWeek(week),
          assignments: '-',
          isEnhanced: true // Mark as enhanced/filled
        });
      }
    }
    
    // Store enhancements for this course (would need to be passed to parent component)
    console.log('Course enhancements tracked:', enhancements);
    
    return rows;
  }
  
  private parseRawSyllabusContent(content: string): any[] {
    const rows: any[] = [];
    const lines = content.split('\n');
    let currentWeek = '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Check if this is a week header
      const weekMatch = line.match(/^Week\s+(\d+)/i);
      if (weekMatch) {
        currentWeek = weekMatch[1];
        continue;
      }
      
      // Parse lines with pipe separators
      if (line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        
        let week = '';
        let date = '';
        let topics = '';
        let assignments = '';
        
        if (parts.length === 4) {
          week = parts[0];
          date = parts[1];
          topics = parts[2];
          assignments = parts[3];
        } else if (parts.length === 3) {
          date = parts[0];
          topics = parts[1];
          assignments = parts[2];
        } else if (parts.length === 2) {
          date = parts[0];
          topics = parts[1];
        }
        
        // Clean up week number
        if (week && week.match(/^\d+$/)) {
          currentWeek = week;
        }
        
        // Check if topics contains assignments
        if (this.isAssignment(topics) && !assignments) {
          assignments = topics;
          topics = this.getDefaultTopicForWeek(parseInt(currentWeek) || 0);
        }
        
        rows.push({
          week: currentWeek || '-',
          date: this.cleanDate(date) || '-',
          topics: this.enhanceTopic(topics) || '-',
          assignments: assignments || '-'
        });
      }
    }
    
    return rows;
  }
  
  private isAssignment(text: string): boolean {
    const assignmentKeywords = ['HW', 'Homework', 'Quiz', 'Test', 'Exam', 'DUE', 'Due', 'Assignment', 'Project'];
    return assignmentKeywords.some(keyword => text.includes(keyword));
  }
  
  private enhanceTopic(topic: string): string {
    // Enhance brief topics with more detail
    const enhancements: { [key: string]: string } = {
      'SQL': 'SQL Fundamentals: DDL, DML, and Basic Queries',
      'MongoDB': 'MongoDB: Document Stores and Aggregation Framework',
      'NoSQL': 'NoSQL Databases: Types and Use Cases',
      'BPMN': 'Business Process Modeling Notation (BPMN)',
      'UML': 'Unified Modeling Language (UML) Diagrams',
      'Methodologies': 'Software Development Methodologies: Agile, Waterfall, DevOps',
      'Form Groups': 'Team Formation and Project Planning',
      'Review': 'Course Review and Exam Preparation'
    };
    
    // Check if we have an enhancement
    for (const [key, value] of Object.entries(enhancements)) {
      if (topic === key) {
        return value;
      }
    }
    
    return topic;
  }
  
  private getDefaultTopicForWeek(week: number): string {
    // Provide meaningful default topics for gap weeks
    const defaultTopics: { [key: number]: string } = {
      6: 'SQL Advanced Topics: Indexes, Views, and Stored Procedures',
      8: 'Mid-semester Review and Project Work Session',
      0: 'Course Content Review'
    };
    
    return defaultTopics[week] || 'Independent Study / Office Hours';
  }

  private extractWeekFromDate(date: string): string {
    const weekMatch = date.match(/Week\s+(\d+)/i);
    return weekMatch ? weekMatch[1] : '';
  }

  private cleanDate(date: string): string {
    // Remove "Week X" prefix if present
    return date.replace(/^Week\s+\d+\s*/i, '').trim();
  }


  getTopicIcon(topic: string): string {
    const topicLower = topic.toLowerCase();
    
    if (topicLower.includes('database') || topicLower.includes('sql')) {
      return 'storage';
    } else if (topicLower.includes('programming') || topicLower.includes('python')) {
      return 'code';
    } else if (topicLower.includes('project') || topicLower.includes('management')) {
      return 'assignment';
    } else if (topicLower.includes('analysis') || topicLower.includes('design')) {
      return 'analytics';
    } else if (topicLower.includes('cloud')) {
      return 'cloud';
    } else if (topicLower.includes('test')) {
      return 'bug_report';
    } else {
      return 'school';
    }
  }
}