// Firestore como base de datos de categorías.
// data.json local actúa como caché/fallback si Firestore no está disponible.
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyC4l2Nk2JDFdcm7j1Geps94ASpHgC7Vb9g',
  authDomain: 'charadas-emoji.firebaseapp.com',
  projectId: 'charadas-emoji',
  storageBucket: 'charadas-emoji.firebasestorage.app',
  messagingSenderId: '938697617943',
  appId: '1:938697617943:web:b649f20ba58d009641e252',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const COL = 'categories';

// Carga todas las categorías. Devuelve null si Firestore falla (usar caché local).
async function loadCategories() {
  const snap = await getDocs(collection(db, COL));
  const cats = [];
  snap.forEach(d => cats.push(d.data()));
  cats.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return cats;
}

// Guarda una categoría (upsert)
async function saveCategory(cat) {
  await setDoc(doc(db, COL, cat.id), cat);
}

// Guarda todas (usado en import y seed inicial)
async function saveAllCategories(cats) {
  await Promise.all(cats.map((c, i) => setDoc(doc(db, COL, c.id), { order: i, ...c })));
}

async function deleteCategory(id) {
  await deleteDoc(doc(db, COL, id));
}

module.exports = { loadCategories, saveCategory, saveAllCategories, deleteCategory };
