import { Component, ElementRef, ViewChild, inject, signal, ChangeDetectionStrategy} from '@angular/core';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule} from '@angular/material/form-field';
import { getStorage, ref } from "firebase/storage";
import { doc, getDocs, collection,setDoc, serverTimestamp, Firestore } from "firebase/firestore";
import { storage as firebaseStorage, db as firebaseDB } from "../firebase"
import { uploadBytes } from "firebase/storage";
import { ProcessedDoc } from "../models/ProcessedDoc"
import { Status } from "../enum/Status"
import { Router } from '@angular/router';
import {MatButtonModule} from '@angular/material/button';
import {MatCardModule} from '@angular/material/card';

@Component({
  selector: 'app-upload-file-component',
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule,MatCardModule, MatButtonModule],
  templateUrl: './upload-file-component.html',
  styleUrl: './upload-file-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadFileComponent {
  private storage = getStorage();
  documentsCol = collection(firebaseDB, 'users/test-user/documents');
  private router = inject(Router);
  
  originalImgUrl = signal<string>('');
  isProcessing = signal<boolean>(false);
  selectedFile: File | null = null; 
  scanner: any;
  comment = " ";

  @ViewChild('originalImg') originalImg!: ElementRef<HTMLImageElement>;
  @ViewChild('resultContainer') resultContainer!: ElementRef<HTMLDivElement>;

  onFileSelected(event:any){
      // console.log('shoudl change nowwww');
    const file: File = event.target.files[0];
    if(file){
      this.selectedFile = file;
      const url = URL.createObjectURL(file);
      this.originalImgUrl.set(url);
      // console.log('shoudl change now');
      if(this.resultContainer?.nativeElement){
        this.resultContainer.nativeElement.innerHTML = '';
      }
      this.originalImg.nativeElement.src = this.originalImgUrl();

      setTimeout(() => {
        this.processImage();
      },100);
    }
  }

  async processImage(){
    if (!this.originalImg) return;

    if (!this.scanner) {
      if (!(window as any).jscanify) {
        console.error('jscanify is not loaded');
        return;
      }
      this.scanner = new (window as any).jscanify();
    }

    setTimeout(() => {
      const img = this.originalImg.nativeElement;
const resultCanvas = this.scanner.extractPaper(img, 2480, 3508);
      this.resultContainer.nativeElement.appendChild(resultCanvas);

      this.applyFilter(resultCanvas, 'bw');

    }, 100);

  }

  applyFilter(canvas: HTMLCanvasElement, filterType: string) {
    canvas.style.filter = filterType === 'bw'
    ? 'grayscale(100%) contrast(100%) brightness(1.1)'
    : 'none';
  }

  async saveDocument(){
    if (!this.selectedFile || !this.resultContainer.nativeElement.firstChild) return;

    this.isProcessing.set(true);
    const canvas = this.resultContainer.nativeElement.querySelector('canvas') as HTMLCanvasElement;

    try{
      const docRef = doc(this.documentsCol);
      const docId = docRef.id;

      const rawPath = `images-test/${docId}_raw`;
      const processedPath = `images-test/${docId}`;

      const rawRef = ref(this.storage,rawPath);
      await uploadBytes(rawRef, this.selectedFile);
      
      canvas.toBlob(async(blob) => {
        if (!blob) return;

        const processedRef = ref(this.storage, processedPath);
        await uploadBytes(processedRef, blob);

        const document: ProcessedDoc = {
          contentType: 'image/png',
          documentDate: null,
          fileName: this.selectedFile!.name,
          folderId: "inbox", // Default to "Inbox" (See answer below)
          ocrText: null, 
          comment: this.comment,
          status: Status.Processed, // It's ready immediately now!
          processedFilePath: processedPath,         
          rawFilePath: rawPath,       
         uploadedAt: serverTimestamp(),
          tag: 'scan',
          id: docId
        };

        await setDoc(docRef, document);

        console.log('scan saved');
        this.router.navigate(['/viewDocs']);
      })
    } catch (err) {
      console.error('Error saving:', err);
      this.isProcessing.set(false);
    }
  }


  // type = '';

  // onTagSelect(event: any) {
  //   this.type = event.target.value;
  //   console.log('changed to ' + this.type);
  // }

 
  // onFileSelected(event: any) {
  //   const file: File = event.target.files[0];
  //   const filename = file.name;

  //   const docRef = doc(this.documentsCol);
  //   const docId = docRef.id;

  //   const document : SubmitDocument = {
  //     contentType: file.type,
  //     documentDate: null,
  //     fileName : filename,
  //     folderId : "images-test", //should the user decide before submission or after document is read? hmhmmhm
  //     ocrText : null,
  //     status : Status.Processing,
  //     storagePath : 'images-test/' + docId, //curious on this one too, should rethink workflow.
  //     uploadedAt : serverTimestamp(),
  //     tag: this.type
  //   }

  //   const storageRef = ref(this.storage, 'images-test/' + docId);
  //   uploadBytes(storageRef, file).then((snapshot) => {
  //     setDoc(docRef, {
  //       ...document              
  //     });
  //       // console.log('Uploaded ' + filename + ' to Firebase Storage and Firestore');
  //     });

  //       this.router.navigate(['/viewDocs']);

  // }

}
