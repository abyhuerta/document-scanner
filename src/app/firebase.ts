
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import {collection} from "firebase/firestore";
import {getDocs} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebaseConfig } from '../environments/environment';



const app = initializeApp(firebaseConfig);

//const analytics = getAnalytics(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// export async function getidk() {
//   const citiesCol = collection(db, 'testcollection');
//   const citySnapshot = await getDocs(citiesCol);
//   const cityList = citySnapshot.docs.map(doc => doc.data());
//   return cityList;
// }