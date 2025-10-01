import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { JobTitle } from '../../shared/interfaces/data-models';

@Component({
  selector: 'app-job-details-dialog',
  templateUrl: './job-details-dialog.component.html',
  styleUrls: ['./job-details-dialog.component.scss'],
  standalone: false
})
export class JobDetailsDialogComponent {
  
  constructor(
    public dialogRef: MatDialogRef<JobDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public job: JobTitle
  ) {}

  close(): void {
    this.dialogRef.close();
  }

  getExperienceLevelLabel(): string {
    if (!this.job.experienceLevel) return 'Not specified';
    
    const levelMap: { [key: string]: string } = {
      'entry': 'Entry Level',
      'mid': 'Mid-Level',
      'senior': 'Senior Level',
      'lead': 'Lead/Principal'
    };
    
    return levelMap[this.job.experienceLevel] || this.job.experienceLevel;
  }

  hasDetails(): boolean {
    return !!(this.job.description || this.job.skills?.length || 
             this.job.trends || this.job.averageSalary || this.job.experienceLevel);
  }

  getDataSourceText(): string {
    if (this.job.source === 'live') {
      return 'Industry trends from web search';
    } else if (this.job.source === 'cached') {
      return 'Previously fetched industry trends';
    } else if (this.job.source === 'manual') {
      return 'User-defined information';
    }
    return 'Career market analysis';
  }
  
  getDataSourceTooltip(): string {
    return 'This shows typical requirements and trends for this role across the industry. ' +
           'It is NOT a specific job posting you can apply to, but rather market intelligence ' +
           'to help you understand career requirements and prepare for job searches.';
  }

  getTimeAgo(): string {
    if (!this.job.fetchedAt) return '';
    
    const fetched = new Date(this.job.fetchedAt);
    const now = new Date();
    const diffMs = now.getTime() - fetched.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMins > 0) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    }
    return 'Just now';
  }
}