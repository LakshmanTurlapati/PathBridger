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
    EXCEL_DATA: 'pathfinder_v2_excel_data',
    SYLLABUS_DATA: 'pathfinder_syllabus_data_v2',
    SYLLABUS_CACHE: 'pathfinder_syllabus_cache',
    CACHED_JOB_TITLES: 'cached_job_titles'
  },

  // API Timeout configuration (in milliseconds)
  TIMEOUTS: {
    API_SHORT: 15000,      // 15 seconds - for quick operations
    API_MEDIUM: 30000,     // 30 seconds - for standard operations
    API_LONG: 45000,       // 45 seconds - for complex operations
    API_EXTENDED: 60000,   // 60 seconds - for very complex operations
    DEBOUNCE_AUTOSAVE: 2000, // 2 seconds - for auto-save debounce
    CONNECTION_TEST: 10000   // 10 seconds - for API connection tests
  },

  // File processing limits
  FILE_LIMITS: {
    MAX_SIZE_MB: 10,
    MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
    MAX_PDF_PAGES: 100,
    MAX_COURSES_PER_FILE: 500
  },

  // Cache configuration
  CACHE_CONFIG: {
    JOB_CACHE_DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
    SYLLABUS_CACHE_VERSION: '2.0'
  },

  // xAI Grok API configuration
  GROK_API: {
    BASE_URL: 'https://api.x.ai/v1/chat/completions',      // For non-search requests
    RESPONSES_URL: 'https://api.x.ai/v1/responses',        // For web search (Agent Tools API)
    MODEL: 'grok-3-mini',                                   // For non-search requests
    SEARCH_MODEL: 'grok-4-1-fast',                         // Optimized for agentic tool calling
    DEFAULT_CONFIG: {
      temperature: 0.3,
      max_tokens: 1024,
      top_p: 0.8,
      reasoning_effort: 'low' as 'low' | 'high'
    },
    // Web search tools for Responses API
    SEARCH_TOOLS: [
      { type: 'web_search' }
    ]
  },

  // Excel parsing configuration
  EXCEL_CONFIG: {
    REQUIRED_COLUMNS: ['title'],
    OPTIONAL_COLUMNS: ['code', 'description', 'credit_hours'],
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    SUPPORTED_EXTENSIONS: ['.xlsx', '.xls', '.csv', '.pdf']
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