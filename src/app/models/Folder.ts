import { Timestamp } from "firebase/firestore";

export interface Folder{
    name: string;
    createdAt: Timestamp;
}