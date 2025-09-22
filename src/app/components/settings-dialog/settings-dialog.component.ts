import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SettingsService } from '../../core/services/settings.service';
import { AiClientService } from '../../core/services/ai-client.service';
import { AppSettings } from '../../shared/interfaces/data-models';

@Component({
  selector: 'app-settings-dialog',
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.scss'],
  standalone: false
})
export class SettingsDialogComponent implements OnInit {
  settingsForm!: FormGroup;
  isTestingConnection = false;
  hideApiKey = true;
  currentSettings!: AppSettings;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<SettingsDialogComponent>,
    private settingsService: SettingsService,
    private aiClientService: AiClientService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.currentSettings = this.settingsService.getCurrentSettings();
    this.initializeForm();
  }

  private initializeForm(): void {
    const currentApiKey = this.settingsService.getGrokApiKey();
    
    this.settingsForm = this.fb.group({
      grokApiKey: [currentApiKey, [
        Validators.pattern(/^xai-[0-9A-Za-z-_]{40,}$/)
      ]],
      theme: [this.currentSettings.theme || 'light'],
      autoSaveProgress: [this.currentSettings.autoSaveProgress ?? true]
    });
  }

  testConnection(): void {
    const apiKey = this.settingsForm.get('grokApiKey')?.value;
    
    if (!apiKey) {
      this.showError('Please enter an API key first');
      return;
    }

    if (!this.settingsService.validateApiKey(apiKey)) {
      this.showError('Invalid API key format. Should start with "xai-"');
      return;
    }

    this.isTestingConnection = true;
    
    // Temporarily set the API key for testing
    this.settingsService.setGrokApiKey(apiKey).subscribe(() => {
      this.aiClientService.testApiConnection().subscribe({
        next: (success) => {
          this.isTestingConnection = false;
          if (success) {
            this.showSuccess('API connection successful!');
          } else {
            this.showError('API connection failed. Please check your key.');
          }
        },
        error: (error) => {
          this.isTestingConnection = false;
          this.showError(`Connection test failed: ${error.message}`);
        }
      });
    });
  }

  saveSettings(): void {
    if (this.settingsForm.invalid) {
      this.showError('Please fix form errors before saving');
      return;
    }

    const formValues = this.settingsForm.value;
    
    // Save API key if provided
    if (formValues.grokApiKey) {
      this.settingsService.setGrokApiKey(formValues.grokApiKey).subscribe();
    }

    // Save other settings
    this.settingsService.updateSettings({
      theme: formValues.theme,
      autoSaveProgress: formValues.autoSaveProgress
    }).subscribe({
      next: () => {
        this.showSuccess('Settings saved successfully');
        this.dialogRef.close(true);
      },
      error: (error) => {
        this.showError(`Failed to save settings: ${error.message}`);
      }
    });
  }

  clearApiKey(): void {
    this.settingsForm.patchValue({ grokApiKey: '' });
    this.settingsService.setGrokApiKey('').subscribe(() => {
      this.showInfo('API key cleared');
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  // Helper methods for notifications
  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private showInfo(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['info-snackbar']
    });
  }

  // Helper method for API key display
  getApiKeyDisplayValue(): string {
    const apiKey = this.settingsForm.get('grokApiKey')?.value;
    if (!apiKey) return '';
    if (this.hideApiKey && apiKey.length > 10) {
      return `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;
    }
    return apiKey;
  }

  // Validation helper
  get apiKeyError(): string {
    const control = this.settingsForm.get('grokApiKey');
    if (control?.hasError('pattern')) {
      return 'API key must start with "xai-" followed by at least 40 characters';
    }
    return '';
  }
}