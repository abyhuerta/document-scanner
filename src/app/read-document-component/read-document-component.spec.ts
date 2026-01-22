import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReadDocumentComponent } from './read-document-component';

describe('ReadDocumentComponent', () => {
  let component: ReadDocumentComponent;
  let fixture: ComponentFixture<ReadDocumentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReadDocumentComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ReadDocumentComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
