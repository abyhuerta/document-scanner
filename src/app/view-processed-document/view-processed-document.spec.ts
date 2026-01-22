import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewProcessedDocument } from './view-processed-document';

describe('ViewProcessedDocument', () => {
  let component: ViewProcessedDocument;
  let fixture: ComponentFixture<ViewProcessedDocument>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewProcessedDocument]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewProcessedDocument);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
