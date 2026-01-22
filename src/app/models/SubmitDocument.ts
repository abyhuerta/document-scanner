import { FieldValue } from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import { Status } from "../enum/Status";

export interface SubmitDocument{
    contentType: string;
    documentDate: Timestamp | null;
    fileName: string;
    folderId: string;
    ocrText: string | null;
    status: Status;
    storagePath: string;
    uploadedAt: FieldValue;
    tag: string;
}
    