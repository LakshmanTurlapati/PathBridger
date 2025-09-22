import { Injectable } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { ExcelCourse, ExcelParsingResult } from '../../shared/interfaces/data-models';
import { CourseWithSyllabus, SyllabusContent, WeeklySchedule } from '../../shared/interfaces/syllabus.models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';

@Injectable({
  providedIn: 'root'
})
export class ExcelParserService {
  constructor() {}

  /**
   * Parse Excel file and extract course data
   */
  parseExcelFile(file: File): Observable<ExcelParsingResult> {
    return from(this.processExcelFile(file)).pipe(
      catchError(error => {
        console.error('Excel parsing error:', error);
        return throwError(() => new Error(`Failed to parse Excel file: ${error.message}`));
      })
    );
  }

  /**
   * Validate file before processing
   */
  validateFile(file: File): { isValid: boolean; error?: string } {
    // Check file size
    if (file.size > APP_CONSTANTS.EXCEL_CONFIG.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: `File size exceeds ${APP_CONSTANTS.EXCEL_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB limit`
      };
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    const isValidExtension = APP_CONSTANTS.EXCEL_CONFIG.SUPPORTED_EXTENSIONS.some(ext => 
      fileName.endsWith(ext)
    );

    if (!isValidExtension) {
      return {
        isValid: false,
        error: `Unsupported file type. Supported formats: ${APP_CONSTANTS.EXCEL_CONFIG.SUPPORTED_EXTENSIONS.join(', ')}`
      };
    }

    return { isValid: true };
  }

  /**
   * Process the Excel file and extract course data
   */
  private async processExcelFile(file: File): Promise<ExcelParsingResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error('Failed to read file data'));
            return;
          }

          const workbook = XLSX.read(data, { type: 'binary' });
          const result = this.extractCoursesFromWorkbook(workbook);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read Excel file'));
      };

      reader.readAsBinaryString(file);
    });
  }

  /**
   * Extract courses from the workbook
   */
  private extractCoursesFromWorkbook(workbook: XLSX.WorkBook): ExcelParsingResult {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('No worksheets found in Excel file');
    }

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!jsonData || jsonData.length === 0) {
      throw new Error('No data found in Excel file');
    }

    const result = this.processRows(jsonData as any[][]);
    return result;
  }

  /**
   * Process rows and extract course information
   */
  private processRows(rows: any[][]): ExcelParsingResult {
    const errors: string[] = [];
    const courses: ExcelCourse[] = [];
    
    if (rows.length === 0) {
      throw new Error('Excel file is empty');
    }

    // Detect header row and find required columns
    const headerRow = rows[0];
    const columnMap = this.detectColumns(headerRow);
    
    if (!columnMap['title']) {
      errors.push('Required "title" column not found. Please ensure your Excel file has a column named "title", "course title", "course name", or "name"');
    }

    // Process data rows (skip header)
    let validRows = 0;
    for (let i = 1; i < rows.length; i++) {
      try {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const course = this.extractCourseFromRow(row, columnMap, i + 1);
        if (course) {
          courses.push(course);
          validRows++;
        }
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      courses,
      totalRows: rows.length - 1, // Exclude header
      validRows,
      errors
    };
  }

  /**
   * Detect column positions based on header row
   */
  private detectColumns(headerRow: any[]): { [key: string]: number | null } {
    const columnMap: { [key: string]: number | null } = {
      title: null,
      code: null,
      description: null,
      credit_hours: null,
      category: null,
      syllabus_content: null,
      syllabus_file: null
    };

    console.log('\n=== COLUMN DETECTION ===');
    console.log('Header Row:', headerRow);
    
    headerRow.forEach((header, index) => {
      if (!header) return;
      
      const headerStr = header.toString().toLowerCase().trim();
      console.log(`Column ${index}: "${header}" -> normalized: "${headerStr}"`);
      
      // Detect title column
      if (headerStr.includes('title') || headerStr.includes('course') || headerStr.includes('name')) {
        columnMap['title'] = index;
        console.log(`  ✓ Detected as TITLE column`);
      }
      
      // Detect code column
      if (headerStr.includes('code') || headerStr.includes('number') || headerStr.includes('id')) {
        columnMap['code'] = index;
        console.log(`  ✓ Detected as CODE column`);
      }
      
      // Detect description column
      if (headerStr.includes('description') || headerStr.includes('desc') || headerStr.includes('detail')) {
        columnMap['description'] = index;
        console.log(`  ✓ Detected as DESCRIPTION column`);
      }
      
      // Detect credit hours column
      if (headerStr.includes('credit') || headerStr.includes('hour') || headerStr.includes('unit')) {
        columnMap['credit_hours'] = index;
        console.log(`  ✓ Detected as CREDIT_HOURS column`);
      }
      
      // Detect category column
      if (headerStr.includes('category') || headerStr.includes('type')) {
        columnMap['category'] = index;
        console.log(`  ✓ Detected as CATEGORY column`);
      }
      
      // Detect syllabus content column - be specific to avoid false matches
      // Don't match "content_length" as syllabus content
      if (headerStr.includes('syllabus_content') || headerStr.includes('syllabus content')) {
        columnMap['syllabus_content'] = index;
        console.log(`  ✓ Detected as SYLLABUS_CONTENT column`);
      } else if (headerStr === 'content' || (headerStr.includes('content') && !headerStr.includes('length'))) {
        // Only match generic "content" if it doesn't contain "length"
        columnMap['syllabus_content'] = index;
        console.log(`  ✓ Detected as SYLLABUS_CONTENT column (generic match)`);
      }
      
      // Detect syllabus file column
      if (headerStr.includes('syllabus_file') || headerStr.includes('syllabus file') || headerStr.includes('file')) {
        columnMap['syllabus_file'] = index;
        console.log(`  ✓ Detected as SYLLABUS_FILE column`);
      }
    });

    console.log('\nFinal Column Mapping:');
    Object.entries(columnMap).forEach(([key, value]) => {
      if (value !== null) {
        console.log(`  ${key}: Column ${value} ("${headerRow[value]}")`);
      } else {
        console.log(`  ${key}: NOT FOUND`);
      }
    });

    return columnMap;
  }

  /**
   * Extract course data from a single row
   */
  private extractCourseFromRow(row: any[], columnMap: { [key: string]: number | null }, rowNumber: number): ExcelCourse | null {
    const titleIndex = columnMap['title'];
    if (titleIndex === null) {
      throw new Error('Title column not found');
    }

    const title = row[titleIndex]?.toString()?.trim();
    if (!title) {
      return null; // Skip empty titles
    }

    const course: ExcelCourse = { title };

    // Extract optional fields
    if (columnMap['code'] !== null && row[columnMap['code']]) {
      course.code = row[columnMap['code']].toString().trim();
    }

    if (columnMap['description'] !== null && row[columnMap['description']]) {
      course.description = row[columnMap['description']].toString().trim();
    }

    if (columnMap['credit_hours'] !== null && row[columnMap['credit_hours']]) {
      const creditHours = parseFloat(row[columnMap['credit_hours']].toString());
      if (!isNaN(creditHours)) {
        course.credit_hours = creditHours;
      }
    }

    return course;
  }

  /**
   * Convert ExcelCourse array to format compatible with V1 structure
   */
  convertToV1Format(excelCourses: ExcelCourse[]): string[] {
    return excelCourses.map(course => {
      let formatted = course.title;
      
      // If we have a course code, prepend it to the title (mimicking UTD format)
      if (course.code) {
        formatted = `${course.code} ${course.title}`;
      }
      
      return formatted;
    });
  }

  /**
   * Generate sample Excel data for demo purposes
   */
  generateSampleData(): ExcelCourse[] {
    return [
      { title: 'Applied Machine Learning', code: 'MIS 6341', credit_hours: 3 },
      { title: 'Big Data Analytics', code: 'MIS 6346', credit_hours: 3 },
      { title: 'Cybersecurity Fundamentals', code: 'MIS 6330', credit_hours: 3 },
      { title: 'Cloud Computing Fundamentals', code: 'MIS 6363', credit_hours: 3 },
      { title: 'Python Programming', code: 'MIS 6382', credit_hours: 3 },
      { title: 'Database Management', code: 'MIS 6326', credit_hours: 3 },
      { title: 'System Analysis and Project Management', code: 'MIS 6308', credit_hours: 3 },
      { title: 'Data Visualization', code: 'MIS 6380', credit_hours: 3 },
      { title: 'Business Analytics With R', code: 'MIS 6356', credit_hours: 3 },
      { title: 'Digital Product Management', code: 'MIS 6393', credit_hours: 3 }
    ];
  }

  /**
   * Create a downloadable sample Excel file for users
   */
  createSampleExcelFile(): Blob {
    const sampleData = this.generateSampleData();
    
    // Create worksheet data with headers
    const worksheetData = [
      ['Course Code', 'Course Title', 'Credit Hours', 'Description'],
      ...sampleData.map(course => [
        course.code || '',
        course.title,
        course.credit_hours || 3,
        course.description || 'Course description'
      ])
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Courses');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /**
   * Save parsed course data to localStorage for persistence
   */
  saveCoursesToStorage(courses: ExcelCourse[]): void {
    try {
      const data = {
        courses,
        uploadedAt: new Date().toISOString()
      };
      localStorage.setItem(APP_CONSTANTS.STORAGE_KEYS.EXCEL_DATA, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save courses to storage:', error);
    }
  }

  /**
   * Load saved course data from localStorage
   */
  loadCoursesFromStorage(): ExcelCourse[] | null {
    try {
      const stored = localStorage.getItem(APP_CONSTANTS.STORAGE_KEYS.EXCEL_DATA);
      if (stored) {
        const data = JSON.parse(stored);
        return data.courses || null;
      }
    } catch (error) {
      console.error('Failed to load courses from storage:', error);
    }
    return null;
  }

  /**
   * Clear saved course data
   */
  clearStoredCourses(): void {
    try {
      localStorage.removeItem(APP_CONSTANTS.STORAGE_KEYS.EXCEL_DATA);
    } catch (error) {
      console.error('Failed to clear stored courses:', error);
    }
  }

  /**
   * Parse Excel file with syllabus content
   */
  parseSyllabusExcelFile(file: File): Observable<CourseWithSyllabus[]> {
    return from(this.processSyllabusExcelFile(file)).pipe(
      catchError(error => {
        console.error('Syllabus Excel parsing error:', error);
        return throwError(() => new Error(`Failed to parse syllabus Excel file: ${error.message}`));
      })
    );
  }

  /**
   * Process Excel file containing syllabus data
   */
  private async processSyllabusExcelFile(file: File): Promise<CourseWithSyllabus[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error('Failed to read file data'));
            return;
          }

          const workbook = XLSX.read(data, { type: 'binary' });
          const courses = this.extractSyllabusCoursesFromWorkbook(workbook);
          resolve(courses);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read syllabus Excel file'));
      };

      reader.readAsBinaryString(file);
    });
  }

  /**
   * Extract courses with syllabus from workbook
   */
  private extractSyllabusCoursesFromWorkbook(workbook: XLSX.WorkBook): CourseWithSyllabus[] {
    const sheetName = workbook.SheetNames.find(name => 
      name.toLowerCase().includes('mapping') || name === workbook.SheetNames[0]
    );
    
    if (!sheetName) {
      throw new Error('No suitable worksheet found in Excel file');
    }

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!jsonData || jsonData.length === 0) {
      throw new Error('No data found in syllabus Excel file');
    }

    return this.processSyllabusRows(jsonData as any[][]);
  }

  /**
   * Process rows containing syllabus data
   */
  private processSyllabusRows(rows: any[][]): CourseWithSyllabus[] {
    const courses: CourseWithSyllabus[] = [];
    
    if (rows.length === 0) {
      return courses;
    }

    const headerRow = rows[0];
    const columnMap = this.detectColumns(headerRow);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const course = this.extractCourseWithSyllabusFromRow(row, columnMap, i + 1);
      if (course) {
        courses.push(course);
      }
    }

    return courses;
  }

  /**
   * Extract course with syllabus from row
   */
  private extractCourseWithSyllabusFromRow(row: any[], columnMap: { [key: string]: number | null }, rowNumber: number): CourseWithSyllabus | null {
    const titleIndex = columnMap['title'];
    const codeIndex = columnMap['code'];
    const syllabusContentIndex = columnMap['syllabus_content'];
    
    const title = titleIndex !== null ? row[titleIndex]?.toString()?.trim() : '';
    const code = codeIndex !== null ? row[codeIndex]?.toString()?.trim() : '';
    let syllabusContent = syllabusContentIndex !== null ? row[syllabusContentIndex]?.toString()?.trim() : '';
    
    // Debug logging
    console.log(`\n=== Processing Row ${rowNumber} ===`);
    console.log('Course Code:', code);
    console.log('Course Title:', title);
    console.log('Syllabus Content Index:', syllabusContentIndex);
    
    // Show what's in different columns for debugging
    if (syllabusContentIndex !== null) {
      console.log(`Column ${syllabusContentIndex} value:`, row[syllabusContentIndex]);
    }
    
    // Check if we might be reading the wrong column
    for (let i = 0; i < row.length; i++) {
      const cellValue = row[i]?.toString() || '';
      if (cellValue.length > 100 && cellValue.includes('Week')) {
        console.log(`  ⚠️ Found potential syllabus content in column ${i} (length: ${cellValue.length})`);
        if (i !== syllabusContentIndex) {
          console.log(`  ⚠️ WARNING: This is NOT the column being used! Using column ${syllabusContentIndex} instead`);
          console.log(`  First 100 chars of column ${i}: "${cellValue.substring(0, 100)}..."`);
        }
      }
    }
    
    console.log('Syllabus Content Length:', syllabusContent?.length || 0);
    console.log('Syllabus Content Preview:', syllabusContent?.substring(0, 50) || 'No content');
    
    if (!title && !code) {
      return null;
    }
    
    // Validate syllabus content
    const isValidSyllabusContent = (content: string): boolean => {
      if (!content || content.length < 100) {
        console.warn(`Invalid syllabus content: too short (${content?.length || 0} chars)`);
        return false;
      }
      
      // Check if content is just a number or year
      if (/^\d{4}$/.test(content)) {
        console.error(`ERROR: Syllabus content appears to be a year: "${content}"`);
        return false;
      }
      
      // Check if content contains expected syllabus patterns
      const hasWeekPattern = /week\s+\d+/i.test(content);
      const hasDatePattern = /(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(content);
      const hasPipeDelimiter = content.includes('|');
      
      if (!hasWeekPattern && !hasDatePattern && !hasPipeDelimiter) {
        console.warn('Syllabus content lacks expected patterns (weeks, dates, or pipe delimiters)');
        return false;
      }
      
      return true;
    };

    const course: CourseWithSyllabus = {
      id: code || `course_${rowNumber}`,
      code: code || '',
      number: code || '',
      title: title || '',
      category: columnMap['category'] !== null ? row[columnMap['category']]?.toString()?.trim() : 'Partial',
      syllabusFile: columnMap['syllabus_file'] !== null ? row[columnMap['syllabus_file']]?.toString()?.trim() : undefined,
      contentLength: syllabusContent ? syllabusContent.length : undefined
    };

    // Only parse syllabus if content is valid
    if (syllabusContent && isValidSyllabusContent(syllabusContent)) {
      course.syllabus = this.parseSyllabusContent(syllabusContent, course);
      console.log('✓ Valid syllabus content parsed for:', code);
    } else {
      console.warn(`⚠️ Invalid or missing syllabus content for course: ${code}`);
      console.warn(`  Original content: "${syllabusContent}"`);
      // Don't set invalid content, leave it empty for fallback to work
      course.syllabus = {
        courseCode: course.code,
        courseNumber: course.number,
        courseTitle: course.title,
        category: course.category,
        rawContent: '', // Empty content will trigger fallback
        weeklySchedule: [],
        keyTopics: []
      };
    }

    return course;
  }

  /**
   * Parse syllabus content into structured format
   */
  private parseSyllabusContent(content: string, course: CourseWithSyllabus): SyllabusContent {
    const weeklySchedule = this.parseWeeklySchedule(content);
    const keyTopics = this.extractKeyTopics(content);

    return {
      courseCode: course.code,
      courseNumber: course.number,
      courseTitle: course.title,
      category: course.category,
      rawContent: content,
      weeklySchedule,
      keyTopics
    };
  }

  /**
   * Parse weekly schedule from syllabus content
   */
  private parseWeeklySchedule(content: string): WeeklySchedule[] {
    const schedule: WeeklySchedule[] = [];
    const lines = content.split('\n');
    
    let currentWeek = 0;
    for (const line of lines) {
      const weekMatch = line.match(/Week\s+(\d+)/i);
      if (weekMatch) {
        currentWeek = parseInt(weekMatch[1], 10);
        continue;
      }

      if (currentWeek > 0 && line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 2) {
          const dateMatch = parts[0].match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+/i);
          const topics = parts[1] ? [parts[1]] : [];
          const assignments = parts[2] || undefined;

          schedule.push({
            week: currentWeek,
            date: dateMatch ? dateMatch[0] : `Week ${currentWeek}`,
            topics,
            assignments,
            dueDate: assignments ? this.extractDueDate(assignments) : undefined
          });
        }
      }
    }

    return schedule;
  }

  /**
   * Extract due date from assignment text
   */
  private extractDueDate(text: string): string | undefined {
    const dueDateMatch = text.match(/due.*?(\d{1,2}:\d{2}\s*(pm|am))/i);
    return dueDateMatch ? dueDateMatch[1] : undefined;
  }

  /**
   * Extract key topics from syllabus content
   */
  private extractKeyTopics(content: string): string[] {
    const topics: string[] = [];
    const topicPatterns = [
      /SQL\s*(?:Basics|Advanced|Queries)?/gi,
      /Database\s+\w+/gi,
      /Data\s+\w+/gi,
      /NoSQL/gi,
      /MongoDB/gi,
      /Python\s*(?:Programming)?/gi,
      /Systems?\s+(?:Analysis|Design|Development)/gi,
      /Project\s+Management/gi,
      /Agile\s*(?:Methodology)?/gi,
      /UML\s*(?:Diagrams)?/gi,
      /Cloud\s+Computing/gi,
      /Machine\s+Learning/gi,
      /Analytics/gi
    ];

    for (const pattern of topicPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        topics.push(...matches);
      }
    }

    // Remove duplicates
    return [...new Set(topics)].slice(0, 20);
  }

  /**
   * Load syllabus data from JSON file
   */
  async loadSyllabusDataFromJson(url: string): Promise<CourseWithSyllabus[]> {
    try {
      console.log('Loading syllabus data from:', url);
      
      // Fix the URL path - remove leading slash for relative path
      const fixedUrl = url.startsWith('/') ? url.substring(1) : url;
      
      const response = await fetch(fixedUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Loaded syllabus JSON data:', data);
      
      if (data.courses && Array.isArray(data.courses)) {
        console.log(`Found ${data.courses.length} courses in JSON`);
        
        // Debug: Check each course's rawContent
        data.courses.forEach((course: any, index: number) => {
          console.log(`\nCourse ${index + 1} (${course.id}):`);
          console.log('  Title:', course.title);
          console.log('  ContentLength field:', course.contentLength);
          console.log('  Has Syllabus:', !!course.syllabus);
          if (course.syllabus) {
            console.log('  RawContent length:', course.syllabus.rawContent?.length || 0);
            console.log('  RawContent preview:', course.syllabus.rawContent?.substring(0, 50) || 'No content');
            
            // Check for data corruption
            if (course.syllabus.rawContent === course.contentLength?.toString()) {
              console.error(`  ERROR: Course ${course.id} has rawContent set to contentLength!`);
            }
          }
        });
        
        return data.courses;
      }
      
      console.warn('No courses found in JSON data');
      return [];
    } catch (error) {
      console.error('Failed to load syllabus JSON:', error);
      console.error('URL was:', url);
      return [];
    }
  }
}