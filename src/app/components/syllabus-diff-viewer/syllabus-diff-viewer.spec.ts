import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SyllabusDiffViewer } from './syllabus-diff-viewer';

describe('SyllabusDiffViewer', () => {
  let component: SyllabusDiffViewer;
  let fixture: ComponentFixture<SyllabusDiffViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyllabusDiffViewer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SyllabusDiffViewer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
