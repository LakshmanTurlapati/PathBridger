import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AppSettings } from '../../shared/interfaces/data-models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly storageKey = APP_CONSTANTS.STORAGE_KEYS.SETTINGS;
  
  private settingsSubject = new BehaviorSubject<AppSettings>(this.loadSettings());
  public readonly settings$ = this.settingsSubject.asObservable();

  constructor() {}

  /**
   * Load settings from localStorage with default fallbacks
   */
  private loadSettings(): AppSettings {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as AppSettings;
        return {
          theme: 'light',
          autoSaveProgress: true,
          ...parsed,
          lastUpdated: new Date().toISOString()
        };
      }
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
    }
    
    return this.getDefaultSettings();
  }

  /**
   * Get default settings
   */
  private getDefaultSettings(): AppSettings {
    return {
      theme: 'light',
      autoSaveProgress: true,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get current settings synchronously
   */
  getCurrentSettings(): AppSettings {
    return this.settingsSubject.value;
  }

  /**
   * Update settings and persist to localStorage
   */
  updateSettings(updates: Partial<AppSettings>): Observable<AppSettings> {
    const currentSettings = this.getCurrentSettings();
    const newSettings: AppSettings = {
      ...currentSettings,
      ...updates,
      lastUpdated: new Date().toISOString()
    };

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(newSettings));
      this.settingsSubject.next(newSettings);
    } catch (error) {
      console.error('Failed to save settings to localStorage:', error);
      throw new Error('Failed to save settings');
    }

    return this.settings$;
  }

  /**
   * Simple encryption for API keys (browser-only, not production-grade)
   * Using base64 encoding with a simple XOR cipher for basic obfuscation
   */
  private encryptApiKey(apiKey: string): string {
    if (!apiKey) return '';
    
    const key = 'pathfinder_v2_key'; // Simple key for XOR
    let encrypted = '';
    
    for (let i = 0; i < apiKey.length; i++) {
      const charCode = apiKey.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      encrypted += String.fromCharCode(charCode);
    }
    
    return btoa(encrypted); // Base64 encode the result
  }

  /**
   * Simple decryption for API keys
   */
  private decryptApiKey(encryptedKey: string): string {
    if (!encryptedKey) return '';
    
    try {
      const key = 'pathfinder_v2_key';
      const decoded = atob(encryptedKey); // Base64 decode
      let decrypted = '';
      
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        decrypted += String.fromCharCode(charCode);
      }
      
      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt API key:', error);
      return '';
    }
  }

  /**
   * Set Grok API key with encryption
   */
  setGrokApiKey(apiKey: string): Observable<AppSettings> {
    const encryptedKey = this.encryptApiKey(apiKey);
    return this.updateSettings({
      encryptedApiKey: encryptedKey
    });
  }

  /**
   * Get decrypted Grok API key
   */
  getGrokApiKey(): string {
    const settings = this.getCurrentSettings();
    if (settings.encryptedApiKey) {
      return this.decryptApiKey(settings.encryptedApiKey);
    }
    return '';
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(): boolean {
    return this.getGrokApiKey().length > 0;
  }

  /**
   * Validate API key format (basic validation)
   */
  validateApiKey(apiKey: string): boolean {
    if (!apiKey || apiKey.trim().length === 0) {
      return false;
    }
    
    // Basic validation for xAI API key format
    const xaiKeyPattern = /^xai-[0-9A-Za-z-_]{40,}$/;
    return xaiKeyPattern.test(apiKey.trim());
  }

  /**
   * Clear all settings and API keys
   */
  clearSettings(): Observable<AppSettings> {
    try {
      localStorage.removeItem(this.storageKey);
      const defaultSettings = this.getDefaultSettings();
      this.settingsSubject.next(defaultSettings);
      return this.settings$;
    } catch (error) {
      console.error('Failed to clear settings:', error);
      throw new Error('Failed to clear settings');
    }
  }

  /**
   * Update theme preference
   */
  setTheme(theme: 'light' | 'dark' | 'auto'): Observable<AppSettings> {
    return this.updateSettings({ theme });
  }

  /**
   * Get current theme
   */
  getTheme(): 'light' | 'dark' | 'auto' {
    return this.getCurrentSettings().theme || 'light';
  }

  /**
   * Toggle auto-save preference
   */
  setAutoSave(enabled: boolean): Observable<AppSettings> {
    return this.updateSettings({ autoSaveProgress: enabled });
  }

  /**
   * Check if auto-save is enabled
   */
  isAutoSaveEnabled(): boolean {
    return this.getCurrentSettings().autoSaveProgress ?? true;
  }

  /**
   * Export settings (without API keys for security)
   */
  exportSettings(): Partial<AppSettings> {
    const settings = this.getCurrentSettings();
    return {
      theme: settings.theme,
      autoSaveProgress: settings.autoSaveProgress,
      lastUpdated: settings.lastUpdated
    };
  }

  /**
   * Import settings (without API keys)
   */
  importSettings(importedSettings: Partial<AppSettings>): Observable<AppSettings> {
    // Filter out sensitive data
    const safeSettings: Partial<AppSettings> = {
      theme: importedSettings.theme,
      autoSaveProgress: importedSettings.autoSaveProgress
    };
    
    return this.updateSettings(safeSettings);
  }
}