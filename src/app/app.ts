import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UploadFileComponent } from "./upload-file-component/upload-file-component";
import { ReadDocumentComponent } from "./read-document-component/read-document-component";
import { HomePageComponent } from "./home-page-component/home-page-component";
import { NavBar } from "./nav-bar/nav-bar";

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UploadFileComponent, ReadDocumentComponent, HomePageComponent, NavBar],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('docuscanner');
}
