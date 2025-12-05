import { Component, OnInit, Inject } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, FormControl, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { JobTitle } from '../../shared/interfaces/data-models';
import { JobScraperService } from '../../core/services/job-scraper.service';
import { SettingsService } from '../../core/services/settings.service';
import { NotificationService } from '../../core/services/notification.service';
import { getExperienceLevelLabel } from '../../shared/utils/experience-level.utils';

export interface JobDialogData {
  existingJobs: JobTitle[];
  mode: 'add' | 'fetch' | 'both';
}

export interface JobDialogResult {
  jobs: JobTitle[];
  source: 'manual' | 'fetched' | 'mixed';
}

@Component({
  selector: 'app-job-dialog',
  templateUrl: './job-dialog.component.html',
  styleUrls: ['./job-dialog.component.scss'],
  standalone: false
})
export class JobDialogComponent implements OnInit {
  jobForm!: FormGroup;
  isFetchingJobs = false;
  fetchedJobs: JobTitle[] = [];
  selectedTab = 0;
  
  // Predefined trending job categories
  jobCategories = [
    {
      name: 'Software Engineering',
      jobs: [
        'Software Engineer',
        'Full Stack Developer',
        'Frontend Developer',
        'Backend Developer',
        'Mobile Developer',
        'DevOps Engineer',
        'Site Reliability Engineer',
        'Platform Engineer'
      ]
    },
    {
      name: 'Data & AI',
      jobs: [
        'Data Scientist',
        'Machine Learning Engineer',
        'Data Engineer',
        'AI Research Scientist',
        'MLOps Engineer',
        'Data Analyst',
        'Business Intelligence Analyst',
        'AI Product Manager'
      ]
    },
    {
      name: 'Cloud & Infrastructure',
      jobs: [
        'Cloud Architect',
        'Cloud Engineer',
        'Solutions Architect',
        'Infrastructure Engineer',
        'Network Engineer',
        'Security Engineer',
        'Cloud Security Architect',
        'Kubernetes Engineer'
      ]
    },
    {
      name: 'Product & Design',
      jobs: [
        'Product Manager',
        'Technical Product Manager',
        'UX Designer',
        'UI Designer',
        'Product Designer',
        'UX Researcher',
        'Design System Engineer',
        'Product Owner'
      ]
    },
    {
      name: 'Emerging Tech',
      jobs: [
        'Blockchain Developer',
        'Web3 Developer',
        'Quantum Computing Engineer',
        'AR/VR Developer',
        'IoT Engineer',
        'Robotics Engineer',
        'Computer Vision Engineer',
        'Edge Computing Engineer'
      ]
    }
  ];

  selectedCategoryJobs: Set<string> = new Set();

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<JobDialogComponent>,
    private jobScraperService: JobScraperService,
    private settingsService: SettingsService,
    private notification: NotificationService,
    @Inject(MAT_DIALOG_DATA) public data: JobDialogData
  ) {}

  ngOnInit(): void {
    this.initializeForm();
    
    // Set initial tab based on mode
    if (this.data.mode === 'fetch') {
      this.selectedTab = 1;
    }
  }

  private initializeForm(): void {
    this.jobForm = this.fb.group({
      manualJobs: this.fb.array([
        this.createJobControl()
      ])
    });
  }

  createJobControl(): FormControl {
    return this.fb.control('', [
      Validators.required,
      Validators.minLength(3),
      Validators.maxLength(100)
    ]);
  }

  get manualJobsArray(): FormArray {
    return this.jobForm.get('manualJobs') as FormArray;
  }

  addManualJobField(): void {
    this.manualJobsArray.push(this.createJobControl());
  }

  removeManualJobField(index: number): void {
    if (this.manualJobsArray.length > 1) {
      this.manualJobsArray.removeAt(index);
    }
  }

  toggleJobSelection(job: string): void {
    if (this.selectedCategoryJobs.has(job)) {
      this.selectedCategoryJobs.delete(job);
    } else {
      this.selectedCategoryJobs.add(job);
    }
  }

  isJobSelected(job: string): boolean {
    return this.selectedCategoryJobs.has(job);
  }

  selectAllInCategory(category: any): void {
    category.jobs.forEach((job: string) => {
      this.selectedCategoryJobs.add(job);
    });
  }

  clearAllInCategory(category: any): void {
    category.jobs.forEach((job: string) => {
      this.selectedCategoryJobs.delete(job);
    });
  }

  getCategorySelectionCount(category: any): number {
    return category.jobs.filter((job: string) => this.selectedCategoryJobs.has(job)).length;
  }

  fetchTrendingJobs(): void {
    // Check if API key is configured
    if (!this.settingsService.hasApiKey()) {
      this.showError('Please configure your Grok API key in settings to fetch live job data');
      return;
    }

    this.isFetchingJobs = true;
    
    // Fetch trending jobs using the JobScraperService (force refresh to get latest)
    this.jobScraperService.fetchTrendingJobs('trending tech jobs 2025', 12, true).subscribe({
      next: (result) => {
        this.fetchedJobs = result.jobs;
        
        // Auto-select all fetched jobs
        this.fetchedJobs.forEach(job => {
          this.selectedCategoryJobs.add(job.label);
        });
        
        this.showSuccess(`Fetched ${this.fetchedJobs.length} trending job titles from live web data`);
        this.isFetchingJobs = false;
      },
      error: (error) => {
        console.error('Failed to fetch trending jobs:', error);
        this.showError(`Failed to fetch live job data: ${error.message}`);
        this.isFetchingJobs = false;
      }
    });
  }


  saveJobs(): void {
    const jobs: JobTitle[] = [];
    let source: 'manual' | 'fetched' | 'mixed' = 'manual';
    
    // Collect manual jobs
    if (this.selectedTab === 0) {
      const manualJobValues = this.manualJobsArray.value
        .filter((job: string) => job && job.trim().length > 0)
        .map((job: string) => job.trim());
      
      if (manualJobValues.length === 0) {
        this.showError('Please enter at least one job title');
        return;
      }
      
      manualJobValues.forEach((job: string, index: number) => {
        // Check for duplicates in existing jobs
        if (!this.isDuplicateJob(job)) {
          jobs.push({
            id: `manual-${Date.now()}-${index}`,
            label: job
          });
        }
      });
      
      source = 'manual';
    }
    
    // Collect selected category jobs
    if (this.selectedTab === 1) {
      if (this.selectedCategoryJobs.size === 0) {
        this.showError('Please select at least one job title');
        return;
      }
      
      Array.from(this.selectedCategoryJobs).forEach((job, index) => {
        if (!this.isDuplicateJob(job)) {
          jobs.push({
            id: `category-${Date.now()}-${index}`,
            label: job
          });
        }
      });
      
      source = this.fetchedJobs.length > 0 ? 'fetched' : 'manual';
    }
    
    if (jobs.length === 0) {
      this.showError('All selected jobs already exist');
      return;
    }
    
    const result: JobDialogResult = {
      jobs,
      source
    };
    
    this.dialogRef.close(result);
  }

  private isDuplicateJob(jobTitle: string): boolean {
    return this.data.existingJobs.some(
      job => job.label.toLowerCase() === jobTitle.toLowerCase()
    );
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  // Helper methods for notifications - delegating to NotificationService
  private showSuccess(message: string): void {
    this.notification.showSuccess(message);
  }

  private showError(message: string): void {
    this.notification.showError(message);
  }

  private showInfo(message: string): void {
    this.notification.showInfo(message);
  }

  // Get selected jobs count for display
  get selectedJobsCount(): number {
    if (this.selectedTab === 0) {
      return this.manualJobsArray.value.filter((job: string) => job && job.trim()).length;
    } else {
      return this.selectedCategoryJobs.size;
    }
  }

  // Check if any jobs are selected
  get hasSelectedJobs(): boolean {
    if (this.selectedTab === 0) {
      return this.manualJobsArray.value.some((job: string) => job && job.trim());
    } else {
      return this.selectedCategoryJobs.size > 0;
    }
  }

  // Get experience level label - using shared utility
  getExperienceLevelLabel(level: string): string {
    return getExperienceLevelLabel(level);
  }
}