// Application constants matching V1 behavior

export const APP_CONSTANTS = {
  // AI Analysis thresholds (matching V1's dual threshold system)
  MAPPING_THRESHOLD: 0.60,          // Minimum confidence for creating job-course mappings (lowered to increase mapping rate)
  SUGGESTION_TRIGGER_THRESHOLD: 0.40,  // Overall confidence threshold for triggering suggestions (lowered to reduce unnecessary suggestions)
  
  // Default job titles (fallback when no jobs are provided)
  DEFAULT_JOB_TITLES: [
    'Software Engineer',
    'Data Scientist', 
    'Product Manager',
    'UX/UI Designer',
    'DevOps Engineer',
    'Business Analyst',
    'Machine Learning Engineer',
    'Cybersecurity Specialist',
    'Frontend Developer',
    'Data Engineer'
  ],

  // Default courses (fallback when no Excel is uploaded)
  DEFAULT_COURSES: [
    'MIS 6341 Applied Machine Learning',
    'MIS 6346 Big Data',
    'MIS 6330 Cybersecurity Fundamentals', 
    'MIS 6363 Cloud Computing Fundamentals',
    'MIS 6382 Object Oriented Programming in Python',
    'MIS 6326 Database Management',
    'MIS 6308 System Analysis and Project Management',
    'MIS 6380 Data Visualization',
    'MIS 6356 Business Analytics With R',
    'MIS 6393 Foundations of Digital Product Management'
  ],

  // Local storage keys
  STORAGE_KEYS: {
    SETTINGS: 'pathfinder_v2_settings',
    APP_STATE: 'pathfinder_v2_state',
    EXCEL_DATA: 'pathfinder_v2_excel_data'
  },

  // xAI Grok 3 Mini API configuration
  GROK_API: {
    BASE_URL: 'https://api.x.ai/v1/chat/completions',
    MODEL: 'grok-3-mini',
    DEFAULT_CONFIG: {
      temperature: 0.3,
      max_tokens: 2048,
      top_p: 0.8,
      reasoning_effort: 'high' as 'low' | 'high'
    },
    LIVE_SEARCH_CONFIG: {
      enabled: true, // Live Search enabled for real-time job data
      mode: 'auto' as 'auto' | 'on' | 'off',
      return_citations: false, // Disable citations for cleaner job data
      sources: [{ type: 'web' }]
    }
  },

  // Excel parsing configuration
  EXCEL_CONFIG: {
    REQUIRED_COLUMNS: ['title'],
    OPTIONAL_COLUMNS: ['code', 'description', 'credit_hours'],
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    SUPPORTED_EXTENSIONS: ['.xlsx', '.xls', '.csv']
  },

  // UI Configuration
  UI_CONFIG: {
    STEP_COUNT: 4,
    CONNECTION_SNAP_DISTANCE: 30,
    AUTO_SAVE_DELAY: 2000,
    PROCESSING_MODAL_DELAY: 500
  },

  // Application metadata
  APP_INFO: {
    NAME: 'Pathfinder',
    VERSION: 'v2.0',
    DESCRIPTION: 'AI-Powered Career Path Analysis'
  }
} as const;

// Type-safe access to constants
export type AppConstantsType = typeof APP_CONSTANTS;