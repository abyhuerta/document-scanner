import { Component, inject, signal, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { doc, getDoc, collection } from "firebase/firestore";
import { db as firebaseDB } from "../firebase";
import { ProcessedDoc } from '../models/ProcessedDoc';
import { getStorage, ref, getDownloadURL } from "firebase/storage";
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-view-processed-document',
  imports: [MatProgressSpinnerModule],
  templateUrl: './view-processed-document.html',
  styleUrl: './view-processed-document.css',
})
export class ViewProcessedDocument {

  private storage = getStorage();
  private activatedRoute = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);
  private fileRef!: ReturnType<typeof ref>;
  private fileid = signal('');
  private rawFileURL = signal<string>('');
  fileURL = signal<SafeResourceUrl>('');
  documentData = signal<ProcessedDoc | null>(null);

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    this.activatedRoute.paramMap.subscribe(params => {
      this.fileid.set(params.get('id') || '');
    });

    this.loadDocument();
  }

  async loadDocument() {
    if (!this.fileid()) {
      console.error("No file ID provided in route.");
      return;
    }
      const docRef = doc(firebaseDB, 'users/test-user/documents', this.fileid());
      const docSnap = await getDoc(docRef);

      if(docSnap.exists()){
        const data = docSnap.data();

        const processedDoc: ProcessedDoc = {
          id: docSnap.id,
          contentType: data['contentType'],
          documentDate: data['documentDate'],
          fileName: data['fileName'],
          folderId: data['folderId'],
          ocrText: data['ocrText'],
          status: data['status'],
          comment: data['comment'],
          rawFilePath: data['rawFilePath'],
          processedFilePath: data['processedFilePath'],
          uploadedAt: data['uploadedAt'],
          tag: data['tag']
        };

        this.ngZone.run(() => {
          this.documentData.set(processedDoc);
        });

        this.fileRef = ref(this.storage, processedDoc.processedFilePath);

        getDownloadURL(this.fileRef).then(url => {
         this.ngZone.run(() => {
          this.rawFileURL.set(url);
          this.fileURL.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
         });
        });
      }
  }

  downloadFile() {
    const url = this.rawFileURL();
    if(!url) return;

    fetch(url).then(response => response.blob())
    .then(blob => {
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = this.documentData()?.fileName || 'downloaded_file';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.URL.revokeObjectURL(blobUrl);
    })
    .catch(err => console.error("Error downloading file:", err));

  }
}
