import { Timestamp } from "firebase/firestore";

export interface User{
    name: string;
    createdAt: Timestamp;

}