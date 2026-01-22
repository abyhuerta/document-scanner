import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page-component/home-page-component';
import { UploadFileComponent } from './upload-file-component/upload-file-component';
import { ReadDocumentComponent } from './read-document-component/read-document-component';
import { ViewProcessedDocument } from './view-processed-document/view-processed-document';

export const routes: Routes = [
    {
        path: '',
        component: HomePageComponent,
    },
    {
        path: 'uploadFile',
        component: UploadFileComponent,
    },
    {
        path: 'viewDocs',
        component: ReadDocumentComponent,
    },
    {
        path: 'file/:id',
        component: ViewProcessedDocument
    }
];
