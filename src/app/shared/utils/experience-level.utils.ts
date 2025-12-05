/**
 * Experience level utility functions
 * Centralizes experience level label mapping to avoid duplication
 */

export type ExperienceLevel = 'entry' | 'mid' | 'senior' | 'lead' | string;

const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
  'entry': 'Entry Level',
  'mid': 'Mid-Level',
  'senior': 'Senior Level',
  'lead': 'Lead/Principal',
  'junior': 'Junior',
  'principal': 'Principal',
  'staff': 'Staff',
  'intern': 'Intern'
};

/**
 * Get a human-readable label for an experience level
 * @param level - The experience level key (e.g., 'entry', 'mid', 'senior')
 * @param defaultValue - Optional default value if level is not found
 * @returns The human-readable label
 */
export function getExperienceLevelLabel(level: ExperienceLevel | undefined | null, defaultValue = 'Not specified'): string {
  if (!level) return defaultValue;

  const normalizedLevel = level.toLowerCase().trim();
  return EXPERIENCE_LEVEL_LABELS[normalizedLevel] || level;
}

/**
 * Get all available experience levels
 * @returns An array of experience level objects with key and label
 */
export function getExperienceLevels(): Array<{ key: string; label: string }> {
  return Object.entries(EXPERIENCE_LEVEL_LABELS).map(([key, label]) => ({
    key,
    label
  }));
}

/**
 * Check if a string is a valid experience level
 * @param level - The level to check
 * @returns True if the level is recognized
 */
export function isValidExperienceLevel(level: string): boolean {
  return level.toLowerCase().trim() in EXPERIENCE_LEVEL_LABELS;
}
