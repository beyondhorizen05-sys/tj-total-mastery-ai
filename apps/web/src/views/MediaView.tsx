import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './accessible-forms.css';

type Item = { id: string; title: string; type: string; creator: string; notes: string; status: string; asset_id: string | null };
type Project = { id: string; title: string; brief: string; status: string };
type Asset = { id: string; filename: string; mime_type: string; kind: 'image' | 'audio' | 'video'; bytes: number; project_id: string | null };
type Collection = { id: string; name: string; description: string; item_count: number };

const input: React.CSSProperties = { width: '100%', padding: '8px 10px', color: 'var(--text-main)', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, font: 'inherit' };
const button: React.CSSProperties = { padding: '8px 12px', color: 'var(--text-main)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer' };
const panel: React.CSSProperties = { padding: 16, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 9 };
const itemTypes = ['book', 'movie', 'music', 'podcast', 'game', 'video', 'image', 'other'];
const statuses = ['planned', 'in_progress', 'completed', 'archived'];
const accepted = 'image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg,video/mp4,video/webm';

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export const MediaView: React.FC = () => {
  const [tab, setTab] = useState<'library' | 'studio'>('library');
  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [collectionItems, setCollectionItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [itemDraft, setItemDraft] = useState({ title: '', type: 'book', creator: '', notes: '', status: 'planned', asset_id: '' });
  const [projectDraft, setProjectDraft] = useState({ title: '', brief: '', status: 'idea' });
  const [collectionName, setCollectionName] = useState('');
  const [membership, setMembership] = useState({ collection: '', item: '' });
  const [projectForAsset, setProjectForAsset] = useState('');

  const load = async (q = search) => {
    try {
      const [a, b, c, d] = await Promise.all([
        apiFetch<{ items: Item[] }>(`/api/v1/media/items?q=${encodeURIComponent(q)}`),
        apiFetch<{ projects: Project[] }>('/api/v1/media/projects'),
        apiFetch<{ assets: Asset[] }>('/api/v1/media/assets'),
        apiFetch<{ collections: Collection[] }>('/api/v1/media/collections'),
      ]);
      setItems(a.items); setProjects(b.projects); setAssets(c.assets); setCollections(d.collections);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Media library could not load'); }
  };
  useEffect(() => { void load(''); }, []);

  const createItem = async () => {
    setBusy(true); setMessage('');
    try {
      await apiFetch('/api/v1/media/items', { method: 'POST', body: JSON.stringify({ ...itemDraft, asset_id: itemDraft.asset_id || null }) });
      setItemDraft({ title: '', type: 'book', creator: '', notes: '', status: 'planned', asset_id: '' });
      setMessage('Media item added.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add item'); }
    finally { setBusy(false); }
  };
  const changeStatus = async (item: Item, status: string) => {
    try {
      await apiFetch(`/api/v1/media/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ ...item, status }) });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update item'); }
  };
  const createProject = async () => {
    setBusy(true); setMessage('');
    try {
      await apiFetch('/api/v1/media/projects', { method: 'POST', body: JSON.stringify(projectDraft) });
      setProjectDraft({ title: '', brief: '', status: 'idea' }); setMessage('Creative project saved.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save project'); }
    finally { setBusy(false); }
  };
  const createCollection = async () => {
    setBusy(true); setMessage('');
    try {
      await apiFetch('/api/v1/media/collections', { method: 'POST', body: JSON.stringify({ name: collectionName }) });
      setCollectionName(''); setMessage('Collection created.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create collection'); }
    finally { setBusy(false); }
  };
  const addToCollection = async () => {
    if (!membership.collection || !membership.item) return;
    try {
      await apiFetch(`/api/v1/media/collections/${membership.collection}/items/${membership.item}`, { method: 'POST' });
      setMessage('Added to collection.'); await load();
      if (selectedCollection === membership.collection) await viewCollection(membership.collection);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add to collection'); }
  };
  const viewCollection = async (id: string) => {
    setSelectedCollection(id);
    try { setCollectionItems((await apiFetch<{ items: Item[] }>(`/api/v1/media/collections/${id}/items`)).items); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load collection'); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setMessage('File exceeds the 8 MB import limit.'); return; }
    setBusy(true); setMessage('');
    try {
      const base64 = await fileBase64(file);
      await apiFetch('/api/v1/media/assets', { method: 'POST', body: JSON.stringify({ filename: file.name, mime_type: file.type, base64, project_id: projectForAsset || null }) });
      setMessage('Asset imported to local TJ storage.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import asset'); }
    finally { setBusy(false); }
  };

  return <div className="tj-a11y-view" style={{ height: '100%', overflowY: 'auto', padding: 20, color: 'var(--text-main)' }}>
    <h2 style={{ margin: 0 }}>Creative Studio & Media</h2>
    <p style={{ color: 'var(--text-muted)', maxWidth: 850 }}>Organize creative briefs, small local media assets and watch/read/listen lists. Imported files remain on this computer.</p>
    <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
      <button aria-pressed={tab === 'library'} style={{ ...button, borderColor: tab === 'library' ? 'var(--accent-cyan)' : 'var(--border-subtle)' }} onClick={() => setTab('library')}>Media library</button>
      <button aria-pressed={tab === 'studio'} style={{ ...button, borderColor: tab === 'studio' ? 'var(--accent-cyan)' : 'var(--border-subtle)' }} onClick={() => setTab('studio')}>Creative projects</button>
    </div>
    {message && <p role="status" style={{ color: 'var(--accent-cyan)' }}>{message}</p>}
    {tab === 'library' ? <div className="tj-responsive-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 18 }}>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Add to watch/read/listen list</h3>
          <input aria-label="Media title" style={input} placeholder="Title" value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <select aria-label="Media type" style={input} value={itemDraft.type} onChange={(event) => setItemDraft({ ...itemDraft, type: event.target.value })}>{itemTypes.map((type) => <option key={type}>{type}</option>)}</select>
            <select aria-label="List status" style={input} value={itemDraft.status} onChange={(event) => setItemDraft({ ...itemDraft, status: event.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
          </div>
          <input aria-label="Creator or artist" style={{ ...input, marginTop: 8 }} placeholder="Creator / artist" value={itemDraft.creator} onChange={(event) => setItemDraft({ ...itemDraft, creator: event.target.value })} />
          <textarea aria-label="Media notes" style={{ ...input, marginTop: 8, minHeight: 70 }} placeholder="Notes" value={itemDraft.notes} onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value })} />
          <select aria-label="Local asset for media item" style={{ ...input, marginTop: 8 }} value={itemDraft.asset_id} onChange={(event) => setItemDraft({ ...itemDraft, asset_id: event.target.value })}><option value="">No local asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}</select>
          <button style={{ ...button, marginTop: 10 }} disabled={busy || !itemDraft.title.trim()} onClick={createItem}>Add item</button>
        </section>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Collections</h3>
          <div style={{ display: 'flex', gap: 8 }}><input aria-label="New collection name" style={input} placeholder="New collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} /><button style={button} disabled={!collectionName.trim() || busy} onClick={createCollection}>Create</button></div>
          {collections.map((collection) => <button key={collection.id} aria-pressed={selectedCollection === collection.id} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', marginTop: 8 }} onClick={() => viewCollection(collection.id)}>{collection.name} · {collection.item_count} items</button>)}
          {collections.length > 0 && items.length > 0 && <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <select aria-label="Collection to add to" style={input} value={membership.collection} onChange={(event) => setMembership({ ...membership, collection: event.target.value })}><option value="">Collection</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select aria-label="Media item to add" style={input} value={membership.item} onChange={(event) => setMembership({ ...membership, item: event.target.value })}><option value="">Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
            <button style={button} disabled={!membership.collection || !membership.item} onClick={addToCollection}>Add</button>
          </div>}
          {selectedCollection && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Selected collection: {collectionItems.length ? collectionItems.map((item) => item.title).join(', ') : 'empty'}</p>}
        </section>
      </div>
      <section style={panel}><h3 style={{ marginTop: 0 }}>Your media</h3>
        <div style={{ display: 'flex', gap: 8 }}><input aria-label="Search media by title, creator or notes" style={input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, creator or notes" /><button style={button} onClick={() => load(search)}>Search</button></div>
        {items.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No matching media items.</p>}
        {items.map((item) => <div key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)', padding: '10px 0' }}><strong>{item.title}</strong> · {item.type}{item.creator ? ` · ${item.creator}` : ''}<br/>
          {item.notes && <small style={{ color: 'var(--text-muted)' }}>{item.notes}<br/></small>}
          <select aria-label={`Status for ${item.title}`} style={{ ...input, width: 145, marginTop: 6 }} value={item.status} onChange={(event) => changeStatus(item, event.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
          {item.asset_id && <a style={{ marginLeft: 10, color: 'var(--accent-cyan)' }} href={`/api/v1/media/assets/${item.asset_id}/content`} target="_blank" rel="noreferrer">Open asset</a>}
        </div>)}
      </section>
    </div> : <div className="tj-responsive-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 18 }}>
        <section style={panel}><h3 style={{ marginTop: 0 }}>New creative brief</h3>
          <input aria-label="Creative project title" style={input} placeholder="Project title" value={projectDraft.title} onChange={(event) => setProjectDraft({ ...projectDraft, title: event.target.value })} />
          <textarea aria-label="Creative brief" style={{ ...input, minHeight: 180, marginTop: 8 }} placeholder="Purpose, audience, visual direction, deliverables…" value={projectDraft.brief} onChange={(event) => setProjectDraft({ ...projectDraft, brief: event.target.value })} />
          <select aria-label="Creative project status" style={{ ...input, marginTop: 8 }} value={projectDraft.status} onChange={(event) => setProjectDraft({ ...projectDraft, status: event.target.value })}>{['idea','active','completed','archived'].map((status) => <option key={status}>{status}</option>)}</select>
          <button style={{ ...button, marginTop: 10 }} disabled={busy || !projectDraft.title.trim()} onClick={createProject}>Save project</button>
        </section>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Import local asset</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>PNG, JPEG, GIF, WebP, MP3, WAV, OGG, MP4 or WebM, up to 8 MB. No generation or editing is performed here.</p>
          <select aria-label="Project for imported asset" style={input} value={projectForAsset} onChange={(event) => setProjectForAsset(event.target.value)}><option value="">Unassigned asset</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
          <input aria-label="Import local media asset" style={{ ...input, marginTop: 8 }} type="file" accept={accepted} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; void upload(file); event.target.value = ''; }} />
        </section>
      </div>
      <div style={{ display: 'grid', gap: 18 }}>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Projects</h3>{projects.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No creative projects yet.</p>}
          {projects.map((project) => <div key={project.id} style={{ borderBottom: '1px solid var(--border-subtle)', padding: '10px 0' }}><strong>{project.title}</strong> · {project.status}<p style={{ whiteSpace: 'pre-wrap', margin: '5px 0', color: 'var(--text-muted)' }}>{project.brief || 'No brief yet.'}</p><small>{assets.filter((asset) => asset.project_id === project.id).length} assets</small></div>)}
        </section>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Local assets</h3>{assets.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No imported assets yet.</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>{assets.map((asset) => <div key={asset.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 7, padding: 8 }}>
            {asset.kind === 'image' && <img src={`/api/v1/media/assets/${asset.id}/content`} alt={asset.filename} style={{ width: '100%', maxHeight: 140, objectFit: 'contain' }} />}
            {asset.kind === 'audio' && <audio aria-label={`Play ${asset.filename}`} controls preload="none" src={`/api/v1/media/assets/${asset.id}/content`} style={{ width: '100%' }} />}
            {asset.kind === 'video' && <video aria-label={`Play ${asset.filename}`} controls preload="none" src={`/api/v1/media/assets/${asset.id}/content`} style={{ width: '100%', maxHeight: 140 }} />}
            <div style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{asset.filename}</div><small style={{ color: 'var(--text-muted)' }}>{Math.ceil(asset.bytes / 1024)} KB</small>
          </div>)}</div>
        </section>
      </div>
    </div>}
  </div>;
};
