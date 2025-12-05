import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface NotificationOptions {
  duration?: number;
  action?: string;
  panelClass?: string | string[];
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly defaultDurations: Record<NotificationType, number> = {
    success: 3000,
    error: 5000,
    info: 3000,
    warning: 4000
  };

  constructor(private snackBar: MatSnackBar) {}

  /**
   * Show a success notification
   */
  showSuccess(message: string, options?: NotificationOptions): void {
    this.show(message, 'success', options);
  }

  /**
   * Show an error notification
   */
  showError(message: string, options?: NotificationOptions): void {
    this.show(message, 'error', options);
  }

  /**
   * Show an info notification
   */
  showInfo(message: string, options?: NotificationOptions): void {
    this.show(message, 'info', options);
  }

  /**
   * Show a warning notification
   */
  showWarning(message: string, options?: NotificationOptions): void {
    this.show(message, 'warning', options);
  }

  /**
   * Generic show method for any notification type
   * Disabled - using status bar only for notifications
   */
  show(message: string, type: NotificationType, options?: NotificationOptions): void {
    // Snackbar disabled - status bar provides feedback instead
  }

  /**
   * Dismiss any currently shown notification
   */
  dismiss(): void {
    this.snackBar.dismiss();
  }

  /**
   * Get panel class based on notification type
   */
  private getPanelClass(type: NotificationType, customClass?: string | string[]): string[] {
    const baseClasses: string[] = [`snackbar-${type}`];

    if (customClass) {
      if (Array.isArray(customClass)) {
        baseClasses.push(...customClass);
      } else {
        baseClasses.push(customClass);
      }
    }

    return baseClasses;
  }
}
