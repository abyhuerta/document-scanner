import { Component, signal, NgZone, ChangeDetectorRef, inject } from '@angular/core';
import { getDocs, collection } from "firebase/firestore";
import { db as firebaseDB } from "../firebase";
import { ProcessedDoc } from '../models/ProcessedDoc';
import { CommonModule } from '@angular/common';
import { NavBar } from "../nav-bar/nav-bar";
import { MatTableModule } from '@angular/material/table'; // <--- MUST IMPORT
import { Router } from '@angular/router';

@Component({
  selector: 'app-read-document-component',
  standalone: true, // Standard in v21
  imports: [CommonModule,MatTableModule],
  templateUrl: './read-document-component.html',
})
export class ReadDocumentComponent {
  private router = inject(Router);
  displayedColumns: string[] = ['index', 'fileName', 'status'];
  // 1. Define as a signal instead of a regular array
  processedDocs = signal<ProcessedDoc[]>([]);

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    // 2. Fetch data
    this.fetchDocuments();
  }

  onFileClick(doc: ProcessedDoc) {
    console.log('File clicked:', doc.fileName);
    this.router.navigate(['/file', doc.id]);
  }

  async fetchDocuments() {
    const querySnapshot = await getDocs(
      collection(firebaseDB, 'users/test-user/documents')
    );

    // 3. Map the data
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
        rawFilePath: data['rawFilePath'],
        processedFilePath: data['processedFilePath'],
        uploadedAt: data['uploadedAt'],
      } as ProcessedDoc;
    });

    // 4. Update the signal (Wrap in ngZone to be safe in v21 environments)
    this.ngZone.run(() => {
      this.processedDocs.set(docs);
      // Optional: Manual trigger if using special change detection modes
      this.cdr.detectChanges(); 
    });
  }
}