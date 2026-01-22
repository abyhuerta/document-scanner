import { FieldValue } from "firebase/firestore/lite";
import { Timestamp } from "firebase/firestore";
import { Status } from "../enum/Status";

export interface ProcessedDoc{
    id?: string;
    contentType: string;
    documentDate: Timestamp | null;
    comment: string;
    fileName: string;
    folderId: string;
    processedFilePath: string;
    status: Status;
    rawFilePath: string;
    uploadedAt: Timestamp | FieldValue;
    tag: string;
    ocrText: string | null;
}
    