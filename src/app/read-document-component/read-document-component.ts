import { Component, signal, computed, NgZone, ChangeDetectorRef, inject } from '@angular/core';
import { getDocs, deleteDoc, doc, collection } from 'firebase/firestore';
import { getStorage, ref, deleteObject } from 'firebase/storage';
import { db as firebaseDB } from '../firebase';
import { ProcessedDoc } from '../models/ProcessedDoc';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';

@Component({
  selector: 'app-read-document-component',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './read-document-component.html',
  styleUrl: './read-document-component.css',
})
export class ReadDocumentComponent {
  private router = inject(Router);
  private storage = getStorage();

  processedDocs = signal<ProcessedDoc[]>([]);
  selectionMode = signal(false);
  selectedIds = signal(new Set<string>());
  isDeleting = signal(false);
  activeFilter = signal<string>('all');

  // Unique categories that actually exist in the doc list, prefixed with 'all'
  categories = computed(() => {
    const tags = this.processedDocs()
      .map(d => d.tag?.toLowerCase().trim())
      .filter((t): t is string => !!t);
    return ['all', ...new Set(tags)];
  });

  // Docs after applying the active category filter
  filteredDocs = computed(() => {
    const filter = this.activeFilter();
    if (filter === 'all') return this.processedDocs();
    return this.processedDocs().filter(d => d.tag?.toLowerCase().trim() === filter);
  });

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    this.fetchDocuments();
  }

  // ── Filter ───────────────────────────────────────────────────────
  setFilter(cat: string) {
    this.activeFilter.set(cat);
    this.cancelSelectionMode();
  }

  // ── Normal navigation ────────────────────────────────────────────
  onCardClick(document: ProcessedDoc) {
    if (this.selectionMode()) {
      this.toggleSelect(document.id!);
    } else {
      this.router.navigate(['/file', document.id]);
    }
  }

  // ── Selection mode ───────────────────────────────────────────────
  enterSelectionMode() {
    this.selectionMode.set(true);
    this.selectedIds.set(new Set());
  }

  cancelSelectionMode() {
    this.selectionMode.set(false);
    this.selectedIds.set(new Set());
  }

  toggleSelect(id: string) {
    const next = new Set(this.selectedIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedIds.set(next);
  }

  isSelected(id: string) {
    return this.selectedIds().has(id);
  }

  // ── Delete ───────────────────────────────────────────────────────
  async deleteSelected() {
    const ids = this.selectedIds();
    if (ids.size === 0) return;

    const label = ids.size === 1 ? '1 document' : `${ids.size} documents`;
    if (!window.confirm(`Permanently delete ${label}? This cannot be undone.`)) return;

    this.isDeleting.set(true);

    const toDelete = this.processedDocs().filter(d => ids.has(d.id!));

    await Promise.all(
      toDelete.map(async d => {
        await deleteDoc(doc(firebaseDB, 'users/test-user/documents', d.id!));
        if (d.processedFilePath) {
          try { await deleteObject(ref(this.storage, d.processedFilePath)); } catch { /* already gone */ }
        }
        if (d.rawFilePath) {
          try { await deleteObject(ref(this.storage, d.rawFilePath)); } catch { /* already gone */ }
        }
      }),
    );

    this.processedDocs.update(docs => docs.filter(d => !ids.has(d.id!)));
    this.cancelSelectionMode();
    this.isDeleting.set(false);
  }

  // ── Fetch ────────────────────────────────────────────────────────
  async fetchDocuments() {
    const querySnapshot = await getDocs(
      collection(firebaseDB, 'users/test-user/documents'),
    );

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
        comment: data['comment'] || '',
        tag: data['tag'] || '',
        rawFilePath: data['rawFilePath'],
        processedFilePath: data['processedFilePath'],
        uploadedAt: data['uploadedAt'],
      } as ProcessedDoc;
    });

    this.ngZone.run(() => {
      this.processedDocs.set(docs);
      this.cdr.detectChanges();
    });
  }
}
