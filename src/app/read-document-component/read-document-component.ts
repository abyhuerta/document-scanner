import { Component, signal, NgZone, ChangeDetectorRef, inject } from '@angular/core';
import { getDocs, collection } from 'firebase/firestore';
import { db as firebaseDB } from '../firebase';
import { ProcessedDoc } from '../models/ProcessedDoc';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';

@Component({
  selector: 'app-read-document-component',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './read-document-component.html',
  styleUrl: './read-document-component.css',
})
export class ReadDocumentComponent {
  private router = inject(Router);
  processedDocs = signal<ProcessedDoc[]>([]);

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    this.fetchDocuments();
  }

  onFileClick(doc: ProcessedDoc) {
    this.router.navigate(['/file', doc.id]);
  }

  async fetchDocuments() {
    const querySnapshot = await getDocs(
      collection(firebaseDB, 'users/test-user/documents')
    );

    const docs = querySnapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        contentType: data['contentType'],
        documentDate: data['documentDate'],
        fileName: data['fileName'],
        folderId: data['folderId'],
        ocrText: data['ocrText'] || null,
        status: data['status'],
        comment: data['comment'] || '',
        tag: data['tag'] || '',
        rawFilePath: data['rawFilePath'],
        processedFilePath: data['processedFilePath'],
        uploadedAt: data['uploadedAt'],
      } as ProcessedDoc;
    });

    this.ngZone.run(() => {
      this.processedDocs.set(docs);
      this.cdr.detectChanges();
    });
  }
}
