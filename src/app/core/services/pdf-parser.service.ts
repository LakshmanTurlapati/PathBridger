import { Injectable } from '@angular/core';
import { Observable, from, throwError, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import * as pdfjsLib from 'pdfjs-dist';
import { CourseWithSyllabus, SyllabusContent, WeeklySchedule } from '../../shared/interfaces/syllabus.models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';
import { AiClientService } from './ai-client.service';
import { SettingsService } from './settings.service';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`;

@Injectable({
  providedIn: 'root'
})
export class PdfParserService {

  constructor(
    private aiClient: AiClientService,
    private settingsService: SettingsService
  ) {}

  /**
   * Main entry point for PDF parsing
   * Validates and processes a PDF file to extract course and syllabus data
   */
  parsePdfFile(file: File): Observable<CourseWithSyllabus[]> {
    console.log('PDF Parser: Starting to parse file:', file.name);

    // Validate file first
    const validation = this.validatePdfFile(file);
    if (!validation.isValid) {
      console.error('PDF validation failed:', validation.error);
      return throwError(() => new Error(validation.error || 'Invalid PDF file'));
    }

    // Process the PDF file
    return from(this.processPdfFile(file)).pipe(
      catchError(error => {
        console.error('PDF parsing error:', error);
        return throwError(() => new Error(`Failed to parse PDF: ${error.message}`));
      })
    );
  }

  /**
   * Validates PDF file size and extension
   */
  validatePdfFile(file: File): { isValid: boolean; error?: string } {
    const maxSize = APP_CONSTANTS.EXCEL_CONFIG.MAX_FILE_SIZE;

    if (!file) {
      return { isValid: false, error: 'No file provided' };
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return { isValid: false, error: 'File must be a PDF (.pdf)' };
    }

    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      return { isValid: false, error: `File size exceeds ${maxSizeMB}MB limit` };
    }

    if (file.size === 0) {
      return { isValid: false, error: 'File is empty' };
    }

    return { isValid: true };
  }

  /**
   * Core PDF processing logic
   * Reads PDF file and extracts text content using PDF.js
   */
  private async processPdfFile(file: File): Promise<CourseWithSyllabus[]> {
    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDocument = await loadingTask.promise;

      console.log('PDF loaded successfully');
      console.log('- Pages:', pdfDocument.numPages);

      // Extract text from all pages with improved line break detection
      let fullText = '';
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();

        // CRITICAL FIX: Sort text items spatially before processing
        // This ensures proper reading order for multi-column layouts

        // Step 1: Detect columns by analyzing X-position distribution
        const xPositions = (textContent.items as any[])
          .filter((item: any) => item.str && item.str.trim().length > 0)
          .map((item: any) => item.transform[4]);

        const hasMultipleColumns = this.detectColumns(xPositions);

        // Step 2: Sort items based on column detection
        const sortedItems = (textContent.items as any[]).sort((a, b) => {
          const yDiff = Math.abs(b.transform[5] - a.transform[5]);

          if (hasMultipleColumns) {
            // For multi-column: group by rows first, then sort within rows
            // Use larger Y threshold to group rows across columns
            if (yDiff > 15) {
              return b.transform[5] - a.transform[5]; // Sort by Y (top to bottom)
            }
            // Same row, sort by X (left to right - this reads columns naturally)
            return a.transform[4] - b.transform[4];
          } else {
            // Single column: standard top-to-bottom, left-to-right
            if (yDiff > 5) {
              return b.transform[5] - a.transform[5];
            }
            return a.transform[4] - b.transform[4];
          }
        });

        // Build text with proper line breaks and word spacing
        let pageText = '';
        let lastY = -1;
        let lastX = -1;

        for (let i = 0; i < sortedItems.length; i++) {
          const item: any = sortedItems[i];
          const currentY = item.transform[5]; // Y position
          const currentX = item.transform[4]; // X position
          const itemText = item.str;

          // Skip empty items
          if (!itemText || itemText.trim().length === 0) {
            continue;
          }

          // If Y position changed significantly, it's a new line
          if (lastY !== -1 && Math.abs(currentY - lastY) > 5) {
            pageText += '\n';
            lastX = -1; // Reset X tracking for new line
          } else if (i > 0 && lastX !== -1) {
            // Same line - check X distance to determine if we need a space
            const xDistance = Math.abs(currentX - lastX);
            // Only add space if items are reasonably far apart (not part of same word)
            if (xDistance > 1) {
              pageText += ' ';
            }
          }

          pageText += itemText;
          lastY = currentY;
          lastX = currentX + (item.width || 0); // Update X to end of current item
        }

        fullText += pageText + '\n\n'; // Double newline between pages
      }

      console.log('PDF Text Extraction:');
      console.log('- Pages:', pdfDocument.numPages);
      console.log('- Total text length:', fullText.length);
      console.log('- First 500 chars:', fullText.substring(0, 500));

      // Extract courses from PDF text (now returns Observable, need to convert to Promise)
      const courses = await this.extractCoursesFromPdfText(fullText, file.name).toPromise();
      return courses || [];
    } catch (error) {
      console.error('Error processing PDF:', error);
      throw new Error(`PDF processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extracts course data from PDF text content
   */
  private extractCoursesFromPdfText(text: string, fileName: string): Observable<CourseWithSyllabus[]> {
    console.log('Extracting courses from PDF text...');

    return this.extractCourseFromPdf(text, fileName).pipe(
      map(course => [course]),
      catchError(error => {
        console.error('Error extracting course data:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Extracts a single course with full syllabus data from PDF text
   * Uses hybrid approach: pattern-based extraction with AI fallback
   */
  private extractCourseFromPdf(text: string, fileName: string): Observable<CourseWithSyllabus> {
    console.log('\n=== EXTRACTING COURSE DATA FROM PDF ===');

    // Extract basic course information (synchronous)
    const courseCode = this.extractCourseCode(text, fileName);
    console.log('1. Course Code:', courseCode);

    const title = this.extractTitle(text, fileName);
    console.log('2. Course Title:', title);

    const instructor = this.extractInstructor(text);
    console.log('3. Instructor:', instructor);

    const term = this.extractTerm(text);
    console.log('4. Term:', term);

    const description = this.extractDescription(text);
    console.log('5. Description:', description ? description.substring(0, 100) + '...' : 'None');

    const prerequisites = this.extractPrerequisites(text);
    console.log('6. Prerequisites:', prerequisites);

    // Extract syllabus-specific data (pattern-based first)
    let weeklySchedule = this.extractWeeklySchedule(text);
    console.log('7. Weekly Schedule Entries:', weeklySchedule.length);
    if (weeklySchedule.length > 0) {
      console.log('   First entry:', weeklySchedule[0]);
    }

    let keyTopics = this.extractKeyTopics(text);
    console.log('8. Key Topics:', keyTopics.length);

    let learningObjectives = this.extractLearningObjectives(text);
    console.log('9. Learning Objectives:', learningObjectives?.length || 0);

    const gradingPolicy = this.extractGradingPolicy(text);
    console.log('10. Grading Policy:', gradingPolicy ? gradingPolicy.substring(0, 50) + '...' : 'None');

    const category = this.extractCategory(text, courseCode);
    console.log('11. Category:', category);

    // Validate extraction results
    const isValid = this.validateExtraction(weeklySchedule, keyTopics);
    console.log('12. Validation:', isValid ? 'PASSED' : 'FAILED - Using AI fallback');

    // If validation fails, use AI extraction
    const extractionObservable = !isValid
      ? this.extractWithAI(text, courseCode, title).pipe(
          map(aiResult => {
            console.log('   AI fallback complete, merging results...');
            return {
              weeklySchedule: aiResult.weeklySchedule.length > 0 ? aiResult.weeklySchedule : weeklySchedule,
              keyTopics: aiResult.keyTopics.length > 0 ? aiResult.keyTopics : keyTopics,
              learningObjectives: aiResult.learningObjectives || learningObjectives
            };
          })
        )
      : of({ weeklySchedule, keyTopics, learningObjectives });

    return extractionObservable.pipe(
      map(extracted => {
        console.log('=== FINAL EXTRACTION RESULTS ===');
        console.log('   Weekly Schedule:', extracted.weeklySchedule.length);
        console.log('   Key Topics:', extracted.keyTopics.length);
        console.log('   Learning Objectives:', extracted.learningObjectives?.length || 0);
        console.log('=== EXTRACTION COMPLETE ===\n');

        // Build syllabus content
        const syllabusContent: SyllabusContent = {
          courseCode: courseCode,
          courseNumber: courseCode,
          courseTitle: title,
          category: category,
          rawContent: text,
          weeklySchedule: extracted.weeklySchedule,
          keyTopics: extracted.keyTopics,
          learningObjectives: extracted.learningObjectives,
          prerequisites: prerequisites
        };

        // Build course object
        const course: CourseWithSyllabus = {
          id: courseCode,
          code: courseCode,
          number: courseCode,
          title: title,
          category: category,
          description: description,
          syllabus: syllabusContent
        };

        return course;
      })
    );
  }

  /**
   * Extracts course code from PDF text or filename
   * Patterns: MIS 6308, HMGT 6323, BUAN 6320, HMGT 6323/MIS 6317, etc.
   */
  private extractCourseCode(text: string, fileName: string): string {
    // Try extracting from "Course Number/Section" line first (more accurate)
    const numberSectionPattern = /Course\s+Number\/Section[:\s]*([A-Z]+\s*\d{4}(?:\/[A-Z]+\s*\d{4})?)/i;
    let match = text.match(numberSectionPattern);

    if (match && match[1]) {
      // Extract first code if multiple codes separated by /
      const codes = match[1].split('/');
      const primaryCode = codes[0].replace(/\s+/g, ' ').trim().toUpperCase();
      console.log(`   Found from "Course Number/Section": ${match[1]} -> Using: ${primaryCode}`);
      return primaryCode;
    }

    // Try general course code pattern
    const codePattern = /(?:MIS|HMGT|BUAN|BA|ACCT|FIN|MKTG|OPRE|SYSM)[\s\/]+\d{4}(?:\.\d{3})?/gi;
    const matches = text.match(codePattern);

    if (matches && matches.length > 0) {
      const cleanedCode = matches[0].replace(/[\/\s]+/g, ' ').trim().toUpperCase();
      console.log(`   Found from general pattern: ${matches[0]} -> ${cleanedCode}`);
      return cleanedCode;
    }

    // Fall back to filename extraction
    const fileCodeMatch = fileName.match(/([A-Z]+)_(\d{4})/i);
    if (fileCodeMatch) {
      const fileCode = `${fileCodeMatch[1].toUpperCase()} ${fileCodeMatch[2]}`;
      console.log(`   Extracted from filename: ${fileCode}`);
      return fileCode;
    }

    console.warn('   Could not extract course code!');
    return 'UNKNOWN';
  }

  /**
   * Extracts course title from PDF text or filename
   */
  private extractTitle(text: string, fileName: string): string {
    // Try pattern: "Course Title: [title]" (limited to 100 chars, stop at common delimiters)
    const titlePattern1 = /Course\s+Title\s*:?\s*([A-Za-z\s&\-,]{3,100}?)(?:\s+(?:Ter|Term|Fall|Spring|Summer|Meetings|Professor|Instructor)|$)/i;
    let match = text.match(titlePattern1);

    if (match && match[1]) {
      let title = match[1].trim();
      // Clean up any extra spaces
      title = title.replace(/\s+/g, ' ');
      // Truncate at first period if present
      const periodIndex = title.indexOf('.');
      if (periodIndex > 0 && periodIndex < 80) {
        title = title.substring(0, periodIndex);
      }
      console.log(`   Found from "Course Title": ${title}`);
      return title.trim();
    }

    // Try pattern: After course code on same line (limited capture)
    const titlePattern2 = /(?:MIS|HMGT|BUAN)\s+\d{4}[.\d]*\s+[–-]\s*([A-Za-z\s&\-]{3,80})/i;
    match = text.match(titlePattern2);

    if (match && match[1]) {
      let title = match[1].trim();
      title = title.replace(/\s+/g, ' ');
      return title;
    }

    // Fall back to filename
    const fileTitleMatch = fileName.match(/_([A-Za-z]+(?:[A-Z][a-z]+)*)\./);
    if (fileTitleMatch) {
      // Convert camelCase to spaced words
      return fileTitleMatch[1]
        .replace(/([A-Z])/g, ' $1')
        .trim();
    }

    console.warn('   Could not extract course title');
    return 'Unknown Course';
  }

  /**
   * Extracts instructor name from PDF text
   */
  private extractInstructor(text: string): string | undefined {
    // Pattern: "Professor: [name]" or "Instructor: [name]"
    const instructorPattern = /(?:Professor|Instructor)[:\s]+([^\n]+)/i;
    const match = text.match(instructorPattern);

    if (match && match[1]) {
      return match[1].trim();
    }

    return undefined;
  }

  /**
   * Extracts term information from PDF text
   */
  private extractTerm(text: string): string | undefined {
    // Pattern: "Fall 2025" or "Spring 2024" etc.
    const termPattern = /(Fall|Spring|Summer)\s+\d{4}/i;
    const match = text.match(termPattern);

    if (match) {
      return match[0];
    }

    return undefined;
  }

  /**
   * Extracts course description from PDF text
   */
  private extractDescription(text: string): string | undefined {
    // Pattern: "Course Description:" followed by paragraph
    const descPattern = /Course\s+Description[:\s]+([^\n]+(?:\n(?!\n)[^\n]+)*)/i;
    const match = text.match(descPattern);

    if (match && match[1]) {
      return match[1].trim();
    }

    return undefined;
  }

  /**
   * Extracts prerequisites from PDF text
   */
  private extractPrerequisites(text: string): string[] | undefined {
    // Pattern: "Prerequisites:" or "Prerequisite:" followed by text
    const prereqPattern = /Prerequisite[s]?[:\s]+([^\n]+)/i;
    const match = text.match(prereqPattern);

    if (match && match[1]) {
      // Split by commas or semicolons to create array
      const prereqText = match[1].trim();
      const prereqs = prereqText.split(/[,;]/).map(p => p.trim()).filter(p => p.length > 0);
      return prereqs.length > 0 ? prereqs : [prereqText];
    }

    return undefined;
  }

  /**
   * Extracts weekly schedule from PDF text
   * Pattern: Week # | Date | Topics | Assignments
   * Supports both numeric (Week 1, 2, 3...) and Roman numeral (I, II, III...) formats
   */
  private extractWeeklySchedule(text: string): WeeklySchedule[] {
    const schedule: WeeklySchedule[] = [];
    console.log('   Attempting weekly schedule extraction...');

    // Try Pattern 1: Standard "Week N" format
    const weekPatternNumeric = /Week\s+(\d+)\s+([A-Za-z]+\s+\d+)\s+(.+?)(?=Week\s+\d+|$)/gis;
    let match;
    while ((match = weekPatternNumeric.exec(text)) !== null) {
      const weekNumber = parseInt(match[1]);
      const date = match[2].trim();
      const content = match[3].trim();

      const topics = this.extractTopicsFromWeekContent(content);
      const assignments = this.extractAssignmentsFromWeekContent(content);

      schedule.push({
        week: weekNumber,
        date: date,
        topics: topics,
        assignments: assignments.length > 0 ? assignments.join(', ') : undefined
      });
    }

    if (schedule.length > 0) {
      console.log(`   Found ${schedule.length} entries using numeric Week pattern`);
      return schedule;
    }

    // Try Pattern 2: Roman numerals (I, II, III, IV, V, etc.) - multi-line table format
    const romanToNumber: {[key: string]: number} = {
      'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8,
      'IX': 9, 'X': 10, 'XI': 11, 'XII': 12, 'XIII': 13, 'XIV': 14, 'XV': 15, 'XVI': 16
    };

    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Check if this line is a Roman numeral by itself
      if (romanToNumber[line]) {
        const roman = line;
        const weekNumber = romanToNumber[roman];

        // Next line should be the date
        i++;
        if (i >= lines.length) break;

        const dateLine = lines[i].trim();
        // Match date format: "Aug 25", "Sept 8", "Sep 15", etc.
        const dateMatch = dateLine.match(/^([A-Z][a-z]+)\s+(\d+)$/);

        if (dateMatch) {
          const date = dateLine;

          // Following lines are the topic until we hit next Roman numeral or empty line
          i++;
          let topicLines: string[] = [];

          while (i < lines.length) {
            const topicLine = lines[i].trim();

            // Stop if we hit another Roman numeral or significant break
            if (romanToNumber[topicLine] || topicLine === '') {
              break;
            }

            // Stop if we hit table headers or section markers
            if (topicLine.match(/^(MODULE|TOPIC|ASSIGNED|ASSESSMENT|DUE DATE)/i)) {
              break;
            }

            topicLines.push(topicLine);
            i++;
          }

          // Combine topic lines and extract topics
          const content = topicLines.join(' ');
          const topics = this.extractTopicsFromWeekContent(content);
          const assignments = this.extractAssignmentsFromWeekContent(content);

          if (topics.length > 0) {
            schedule.push({
              week: weekNumber,
              date: date,
              topics: topics,
              assignments: assignments.length > 0 ? assignments.join(', ') : undefined
            });
            console.log(`   Week ${weekNumber}: ${date} - ${topics.length} topics`);
          }

          // Don't increment i here, let the outer loop handle it
          continue;
        }
      }

      i++;
    }

    if (schedule.length > 0) {
      console.log(`   Extracted ${schedule.length} weekly schedule entries (Multi-line Roman numeral pattern)`);
      return schedule;
    }

    // Try Pattern 3: Table format "Week – N" with MM/DD dates
    console.log('   Trying table format pattern (Week – N with MM/DD dates)...');
    i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Check if this line starts with "Week – N" or "Week - N"
      const weekMatch = line.match(/^Week\s*[–-]\s*(\d+)/i);

      if (weekMatch) {
        const weekNumber = parseInt(weekMatch[1]);
        let date = '';
        let topicLines: string[] = [];

        // Look ahead for day name and date in following lines
        let j = i + 1;
        let foundDate = false;

        while (j < lines.length && j < i + 10) { // Look ahead max 10 lines
          const nextLine = lines[j].trim();

          // Check for MM/DD date format
          const dateMatch = nextLine.match(/^(\d{2})\/(\d{2})$/);
          if (dateMatch && !foundDate) {
            // Convert MM/DD to readable format
            const month = parseInt(dateMatch[1]);
            const day = parseInt(dateMatch[2]);
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            date = `${monthNames[month - 1]} ${day}`;
            foundDate = true;
            j++;
            continue;
          }

          // Also check for "Month Day" format (e.g., "Aug 25", "September 1")
          const monthDayMatch = nextLine.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})$/i);
          if (monthDayMatch && !foundDate) {
            const monthStr = monthDayMatch[1];
            const day = monthDayMatch[2];
            // Convert full month names to abbreviations
            const monthMap: { [key: string]: string } = {
              'january': 'Jan', 'february': 'Feb', 'march': 'Mar', 'april': 'Apr',
              'may': 'May', 'june': 'Jun', 'july': 'Jul', 'august': 'Aug',
              'september': 'Sep', 'sept': 'Sep', 'october': 'Oct', 'november': 'Nov', 'december': 'Dec'
            };
            const normalizedMonth = monthMap[monthStr.toLowerCase()] || monthStr.substring(0, 3);
            date = `${normalizedMonth.charAt(0).toUpperCase() + normalizedMonth.slice(1).toLowerCase()} ${day}`;
            foundDate = true;
            j++;
            continue;
          }

          // Skip day names
          if (nextLine.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
            j++;
            continue;
          }

          // Stop if we hit another "Week" marker
          if (nextLine.match(/^Week\s*[–-]\s*\d+/i)) {
            break;
          }

          // Stop at empty lines
          if (nextLine === '') {
            j++;
            if (j < lines.length && lines[j].trim() === '') {
              break; // Two empty lines = section break
            }
            continue;
          }

          // Collect content lines
          if (nextLine.length > 0) {
            topicLines.push(nextLine);
          }

          j++;
        }

        // Process collected content
        if (topicLines.length > 0) {
          const content = topicLines.join(' ');
          const topics = this.extractTopicsFromWeekContent(content);
          const assignments = this.extractAssignmentsFromWeekContent(content);

          if (topics.length > 0) {
            schedule.push({
              week: weekNumber,
              date: date || `Week ${weekNumber}`, // Fallback to "Week N" if no date found
              topics: topics,
              assignments: assignments.length > 0 ? assignments.join(', ') : undefined
            });
            console.log(`   Week ${weekNumber}: ${date || 'No date'} - ${topics.length} topics`);
          }
        }

        i = j; // Jump to where we stopped looking ahead
      } else {
        i++;
      }
    }

    console.log(`   Extracted ${schedule.length} weekly schedule entries (Table format pattern)`);

    // Try Pattern 4: Date-based format "AUG 26" with SESSION numbers
    if (schedule.length === 0) {
      console.log('   Trying date-based pattern (AUG 26 SESSION N)...');

      // Pattern: "AUG 26    TOPIC TEXT    SESSION 1"
      const sessionPattern = /^([A-Z]{3}\s+\d{1,2})\s+(.*?)\s+SESSION\s+(\d+)/gmi;
      let match;

      while ((match = sessionPattern.exec(text)) !== null) {
        const dateStr = match[1].trim();  // "AUG 26"
        const topicLine = match[2].trim();  // "INTRODUCTION" or "MODERN IT ARCHITECTURES"
        const sessionNum = parseInt(match[3]);  // "1"

        // Convert "AUG 26" to readable format
        const dateParts = dateStr.split(/\s+/);
        const month = dateParts[0].charAt(0) + dateParts[0].slice(1).toLowerCase();
        const day = dateParts[1];
        const formattedDate = `${month} ${day}`;

        // Find content after this session header
        const sessionIndex = match.index + match[0].length;
        const nextSessionMatch = text.substring(sessionIndex).search(/^[A-Z]{3}\s+\d{1,2}\s+.*?SESSION\s+\d+/m);
        const contentEnd = nextSessionMatch > 0 ? sessionIndex + nextSessionMatch : text.length;
        const sessionContent = text.substring(sessionIndex, contentEnd);

        // Extract topics from session content
        const topics: string[] = [topicLine];

        // Look for "Lecture", "Readings", "Discussion", "Case" sections
        const lectureMatch = sessionContent.match(/Lecture\s+(.+?)(?=\n(?:Readings|Discussion|Case|$))/is);
        const readingsMatch = sessionContent.match(/Readings\s+([\s\S]+?)(?=\n(?:Discussion|Case|[A-Z]{3}\s+\d{1,2}|$))/i);
        const discussionMatch = sessionContent.match(/Discussion\s+([\s\S]+?)(?=\n(?:Case|[A-Z]{3}\s+\d{1,2}|$))/i);
        const caseMatch = sessionContent.match(/Case\s+([\s\S]+?)(?=\n[A-Z]{3}\s+\d{1,2}|$)/i);

        if (lectureMatch) {
          topics.push(`Lecture: ${lectureMatch[1].trim().split('\n')[0]}`);
        }
        if (readingsMatch) {
          const readings = readingsMatch[1].trim().split('\n').filter(r => r.trim().length > 0);
          readings.slice(0, 2).forEach(r => topics.push(`Reading: ${r.trim()}`));
        }
        if (discussionMatch) {
          const discussion = discussionMatch[1].trim().split('\n')[0];
          if (discussion.length < 100) {
            topics.push(`Discussion: ${discussion}`);
          }
        }

        // Extract assignments
        const assignments: string[] = [];
        if (caseMatch) {
          const caseName = caseMatch[1].trim().split('\n')[0];
          assignments.push(`Case: ${caseName}`);
        }

        if (topics.length > 0) {
          schedule.push({
            week: sessionNum,
            date: formattedDate,
            topics: topics,
            assignments: assignments.length > 0 ? assignments.join(', ') : undefined
          });
          console.log(`   Session ${sessionNum}: ${formattedDate} - ${topics.length} topics`);
        }
      }

      console.log(`   Extracted ${schedule.length} weekly schedule entries (Date-based pattern)`);
    }

    return schedule;
  }

  /**
   * Extracts topics from week content
   */
  private extractTopicsFromWeekContent(content: string): string[] {
    // Split by bullet points or newlines
    const topics = content
      .split(/[•\n]/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && !t.match(/^(HW|Quiz|Project|Exam)/i));

    return topics;
  }

  /**
   * Extracts assignments from week content
   */
  private extractAssignmentsFromWeekContent(content: string): string[] {
    // Pattern: HW 1, Quiz 1, Project, Exam, etc.
    const assignmentPattern = /(HW|Quiz|Project|Exam)\s*\d*[:\s]*(?:[^•\n]*)/gi;
    const matches = content.match(assignmentPattern);

    if (matches) {
      return matches.map(m => m.trim());
    }

    return [];
  }

  /**
   * Extracts key topics from PDF text
   */
  private extractKeyTopics(text: string): string[] {
    const topics = new Set<string>();

    // First, check if there's a dedicated "COURSE DESCRIPTION" or similar section
    // This often contains the main topics before the learning objectives
    const descriptionMatch = text.match(/(?:Course\s+Description|Description|Overview)[:\s]*\n([\s\S]*?)(?=\n(?:LEARNING\s+OBJECTIVES|Learning\s+Objectives|Course\s+Objectives|Objectives|Schedule|SCHEDULE|Grading|$))/i);

    if (descriptionMatch) {
      const descSection = descriptionMatch[1];

      // Extract topic-related keywords and phrases from description
      // Look for things like "data warehousing", "IT management", "business analytics"
      const topicPhrases = descSection.match(/(?:including|such as|focus on|covers?|discuss|explor[ei]|examin[ei]|study|address)[:\s]+([^.!?]+)/gi);

      if (topicPhrases) {
        topicPhrases.forEach(phrase => {
          const cleaned = phrase
            .replace(/^(?:including|such as|focus on|covers?|discuss|explor[ei]|examin[ei]|study|address)[:\s]+/i, '')
            .trim();

          // Split by commas or "and" to get individual topics
          const individualTopics = cleaned.split(/(?:,\s*|\s+and\s+)/);
          individualTopics.forEach(topic => {
            const trimmed = topic.trim();
            if (trimmed.length > 5 && trimmed.length < 100 && !this.isHeaderLine(trimmed)) {
              topics.add(trimmed);
            }
          });
        });
      }
    }

    // If still no topics, try to find a "Key Topics" or "Course Topics" section
    if (topics.size === 0) {
      const topicSectionMatch = text.match(/(?:Key\s+Topics?|Course\s+Topics?|Topics?\s+Covered)[:\s]*\n([\s\S]*?)(?=\n\s*(?:LEARNING\s+OBJECTIVES|Grading|Assessment|Prerequisites?|Textbook|Schedule|Week\s+1|$))/i);

      if (topicSectionMatch) {
        const topicSection = topicSectionMatch[1];

        // Extract bullets, numbers, or dashes
        const itemPattern = /(?:^|\n)\s*(?:[•\-\*]|\d+\.)\s*([^\n]+)/g;
        let match;
        while ((match = itemPattern.exec(topicSection)) !== null) {
          const topic = match[1].trim();
          // Filter out grading, headers, and partial sentences
          if (!this.isGradingOrPolicyText(topic) &&
              !this.isHeaderLine(topic) &&
              topic.length > 10 &&
              topic.length < 150) {
            topics.add(topic);
          }
        }
      }
    }

    // If still no topics found, extract from schedule section topics
    if (topics.size === 0) {
      console.log('   No dedicated topics section found, extracting from schedule...');

      // Look for schedule topics (the main topic line after dates)
      const scheduleTopics = text.match(/^[A-Z]{3}\s+\d{1,2}\s+([A-Z\s,&\-:]+?)\s+SESSION/gm);
      if (scheduleTopics) {
        scheduleTopics.forEach(match => {
          const topicMatch = match.match(/^[A-Z]{3}\s+\d{1,2}\s+([A-Z\s,&\-:]+?)\s+SESSION/);
          if (topicMatch && topicMatch[1]) {
            const topic = topicMatch[1].trim();
            if (topic.length > 5 && topic.length < 100) {
              // Convert to title case for readability
              const titleCase = topic.split(' ')
                .map(word => word.charAt(0) + word.slice(1).toLowerCase())
                .join(' ');
              topics.add(titleCase);
            }
          }
        });
      }
    }

    return Array.from(topics).slice(0, 20); // Limit to top 20
  }

  /**
   * Checks if a line is a section header (all caps, short, no detailed content)
   */
  private isHeaderLine(text: string): boolean {
    // All uppercase and relatively short
    if (text === text.toUpperCase() && text.length < 50) {
      return true;
    }

    // Common header keywords
    const headerKeywords = /^(LEARNING\s+OBJECTIVES?|OBJECTIVES?|SCHEDULE|GRADING|ASSESSMENT|PREREQUISITES?|TEXTBOOK|COURSE\s+DESCRIPTION|DESCRIPTION|OVERVIEW|INTRODUCTION)$/i;
    if (headerKeywords.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if text appears to be grading scale or policy information
   */
  private isGradingOrPolicyText(text: string): boolean {
    // Patterns that indicate grading/policy text
    const gradingPatterns = [
      /\d+%/,  // Percentages
      /\d+\s*-\s*\d+/,  // Number ranges (90-100)
      /[A-F][+-]?\s*=/,  // Grade assignments (A = , B+ =)
      /points?\s*=/i,  // Points assignments
      /grade|grading|exam|quiz|attendance|policy|make-up|accepted|instructor|office\s+hours?|email|phone/i  // Keywords
    ];

    return gradingPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Extracts or infers course category from PDF text or course code
   */
  private extractCategory(text: string, courseCode: string): string {
    // Try to find explicit course type in the PDF
    const courseTypeMatch = text.match(/Course\s+Type[:\s]*([A-Za-z\s]+?)(?:\n|$)/i);
    if (courseTypeMatch && courseTypeMatch[1]) {
      const type = courseTypeMatch[1].trim();
      if (type.match(/core|required|elective|optional/i)) {
        return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
      }
    }

    // Derive category from course code prefix
    const codePrefix = courseCode.match(/^([A-Z]+)/);
    if (codePrefix) {
      const prefix = codePrefix[1];
      const categoryMap: { [key: string]: string } = {
        'MIS': 'Management Information Systems',
        'HMGT': 'Healthcare Management',
        'BUAN': 'Business Analytics',
        'MKTG': 'Marketing',
        'FIN': 'Finance',
        'ACCT': 'Accounting',
        'OPRE': 'Operations Management',
        'ORGB': 'Organizational Behavior',
        'SYSM': 'Systems Engineering'
      };

      if (categoryMap[prefix]) {
        return categoryMap[prefix];
      }
    }

    // Check if the text mentions "graduate" or specific degree programs
    if (text.match(/M\.?S\.?\s+(?:in\s+)?(?:Information|Healthcare|Business)/i)) {
      const programMatch = text.match(/M\.?S\.?\s+(?:in\s+)?(Information|Healthcare|Business)\s+\w+/i);
      if (programMatch) {
        return programMatch[1] + ' Track';
      }
    }

    // Default fallback
    return 'Graduate Course';
  }

  /**
   * Extracts learning objectives from PDF text
   */
  private extractLearningObjectives(text: string): string[] | undefined {
    const objectives: string[] = [];

    // Pattern: "Learning Objectives:" followed by numbered or bulleted list
    const objectivesSection = text.match(/Learning\s+Objectives[:\s]+([^]+?)(?=\n\n|Course\s+Schedule|Grading|$)/i);

    if (objectivesSection && objectivesSection[1]) {
      const content = objectivesSection[1];

      // Extract numbered or bulleted items
      const items = content.match(/(?:^|\n)\s*(?:\d+\.|[•-])\s*([^\n]+)/g);

      if (items) {
        items.forEach(item => {
          const cleaned = item.replace(/^\s*(?:\d+\.|[•-])\s*/, '').trim();
          if (cleaned.length > 0) {
            objectives.push(cleaned);
          }
        });
      }
    }

    return objectives.length > 0 ? objectives : undefined;
  }

  /**
   * Extracts grading policy from PDF text
   */
  private extractGradingPolicy(text: string): string | undefined {
    // Pattern: "Grading:" or "Grading Policy:" followed by content
    const gradingPattern = /Grading\s+(?:Policy)?[:\s]+([^]+?)(?=\n\n|Course\s+Policies|Academic|$)/i;
    const match = text.match(gradingPattern);

    if (match && match[1]) {
      return match[1].trim();
    }

    return undefined;
  }

  /**
   * AI-assisted extraction fallback for complex or non-standard PDF formats
   * Uses Claude API to intelligently extract structured syllabus data
   */
  private extractWithAI(pdfText: string, courseCode: string, title: string): Observable<{
    weeklySchedule: WeeklySchedule[];
    keyTopics: string[];
    learningObjectives: string[] | undefined;
  }> {
    const apiKey = this.settingsService.getGrokApiKey();

    if (!apiKey) {
      console.warn('   AI extraction skipped: No API key configured');
      return of({ weeklySchedule: [], keyTopics: [], learningObjectives: undefined });
    }

    console.log('   Using AI-assisted extraction...');

    // Increased from 8,000 to 25,000 characters to capture more content
    // This ensures later weeks (e.g., Week 10+) are included in AI processing
    const textLimit = 25000;
    const truncatedText = pdfText.length > textLimit
      ? pdfText.substring(0, textLimit) + '\n\n[Content truncated for length]'
      : pdfText;

    const prompt = `Extract structured syllabus data from this course syllabus text.

Course: ${courseCode} - ${title}

Syllabus Text:
${truncatedText}

Extract and return ONLY valid JSON with this exact structure:
{
  "weeklySchedule": [
    {
      "week": <number>,
      "date": "<readable date like 'Aug 26' or 'Sep 2'>",
      "topics": ["<topic 1>", "<topic 2>"],
      "assignments": "<optional: homework, quiz, case study>"
    }
  ],
  "keyTopics": ["<main topic 1>", "<main topic 2>"],
  "learningObjectives": ["<objective 1>", "<objective 2>"]
}

Guidelines:
1. For weeklySchedule:
   - If syllabus has "SESSION 1", "SESSION 2" → use those as week numbers
   - If dates are like "AUG 26", "SEP 02" → convert to "Aug 26", "Sep 2"
   - Extract main topics from each session/week
   - Include assignments (case studies, homework, readings) if mentioned

2. For keyTopics:
   - Extract 5-10 main course topics (NOT learning objectives)
   - Avoid sentence fragments
   - Skip section headers like "LEARNING OBJECTIVES", "SCHEDULE"
   - Focus on subject matter: "IT Management", "Data Warehousing", etc.

3. For learningObjectives:
   - Extract from "LEARNING OBJECTIVES" section if present
   - Should be complete sentences about student outcomes
   - Usually start with verbs: "understand", "gain", "develop"

Return ONLY the JSON, no markdown formatting, no explanations.`;

    return this.aiClient['callGrokApi'](prompt, apiKey, 'medium').pipe(
      map((response: any) => {
        try {
          // Extract JSON from response
          const content = response.choices?.[0]?.message?.content || '';

          // Try to find JSON in the response
          let jsonText = content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }

          const extracted = JSON.parse(jsonText);

          console.log(`   AI extracted: ${extracted.weeklySchedule?.length || 0} weeks, ${extracted.keyTopics?.length || 0} topics, ${extracted.learningObjectives?.length || 0} objectives`);

          return {
            weeklySchedule: extracted.weeklySchedule || [],
            keyTopics: extracted.keyTopics || [],
            learningObjectives: extracted.learningObjectives
          };
        } catch (error) {
          console.error('   AI extraction parsing failed:', error);
          return { weeklySchedule: [], keyTopics: [], learningObjectives: undefined };
        }
      }),
      catchError(error => {
        console.error('   AI extraction failed:', error);
        return of({ weeklySchedule: [], keyTopics: [], learningObjectives: undefined });
      })
    );
  }

  /**
   * Detects if PDF content uses multiple columns based on X-position distribution
   */
  private detectColumns(xPositions: number[]): boolean {
    if (xPositions.length < 10) {
      return false; // Not enough data points
    }

    // Group X positions into clusters
    const sorted = [...xPositions].sort((a, b) => a - b);
    const clusters: number[][] = [];
    let currentCluster: number[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      // If gap is > 100 units, it's likely a new column
      if (sorted[i] - sorted[i - 1] > 100) {
        if (currentCluster.length > 5) { // Require at least 5 items per cluster
          clusters.push(currentCluster);
        }
        currentCluster = [sorted[i]];
      } else {
        currentCluster.push(sorted[i]);
      }
    }

    if (currentCluster.length > 5) {
      clusters.push(currentCluster);
    }

    // If we found 2+ distinct clusters, we likely have multiple columns
    return clusters.length >= 2;
  }

  /**
   * Validates extraction results to determine if AI fallback is needed
   */
  private validateExtraction(weeklySchedule: WeeklySchedule[], keyTopics: string[]): boolean {
    // Check if we have reasonable results
    const hasSchedule = weeklySchedule.length > 0;
    const hasTopics = keyTopics.length > 0;

    // Enhanced validation: check for sequential week numbers
    if (hasSchedule && weeklySchedule.length > 2) {
      const weeks = weeklySchedule.map(w => w.week).sort((a, b) => a - b);
      const hasGaps = weeks.some((week, i) => i > 0 && week - weeks[i - 1] > 3);
      const hasDuplicates = new Set(weeks).size !== weeks.length;

      if (hasGaps || hasDuplicates) {
        console.warn('Schedule validation failed: gaps or duplicates detected');
        return false; // Likely bad extraction, trigger AI fallback
      }
    }

    // Check if topics look valid (not just headers or fragments)
    const topicsValid = keyTopics.every(topic => {
      return topic.length > 5 &&
             topic.length < 150 &&
             !topic.match(/^(LEARNING OBJECTIVES?|SCHEDULE|GRADING|ASSESSMENT)$/i);
    });

    return hasSchedule && hasTopics && topicsValid;
  }
}
