// js/firebase.js
// Firebase Web SDK (CDN, modular). All Firebase calls live here — nothing else
// in the project touches the SDK directly. No Firebase Storage yet (deferred —
// needs Blaze billing enabled first).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  collectionGroup,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ---------------------------------------------------------------------------
// Your real project config (Firebase web apiKeys are meant to be public —
// the real access control is Firestore Security Rules, see firestore.rules)
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBMLIBaPoAW7XYNQ7qz-TImw_u4U-RVLLw",
  authDomain: "life-story-locker.firebaseapp.com",
  projectId: "life-story-locker",
  storageBucket: "life-story-locker.firebasestorage.app",
  messagingSenderId: "470733099336",
  appId: "1:470733099336:web:6e39a4a5864164f406237d",
  measurementId: "G-ZBP686SXT8",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

console.log("Firebase connected:", firebaseConfig.projectId);

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

/** "Remember me" — call BEFORE signUp/logIn/loginWithGoogle. */
export function setRememberMe(remember) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

export async function signUp(email, password, displayName = "") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const name = displayName || email.split("@")[0];
  await updateProfile(cred.user, { displayName: name });
  await saveUserProfile(cred.user.uid, {
    email: cred.user.email,
    displayName: name,
    provider: "password",
    createdAt: serverTimestamp(),
  });
  await ensureDefaultSettings(cred.user.uid);
  return cred.user;
}

export async function logIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await saveUserProfile(cred.user.uid, {
    email: cred.user.email,
    displayName: cred.user.displayName || cred.user.email.split("@")[0],
    provider: "google",
    createdAt: serverTimestamp(),
  });
  await ensureDefaultSettings(cred.user.uid);
  return cred.user;
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function updateDisplayName(newName) {
  if (!auth.currentUser) throw new Error("Not signed in.");
  await updateProfile(auth.currentUser, { displayName: newName });
  await saveUserProfile(auth.currentUser.uid, { displayName: newName });
}

export function logOut() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ---------------------------------------------------------------------------
// USER PROFILE (users/{uid})
// ---------------------------------------------------------------------------

export async function saveUserProfile(uid, profileData) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, profileData, { merge: true });
}

export async function getUserProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------------------------------------------------------------------------
// SETTINGS (users/{uid}/settings/preferences)
// ---------------------------------------------------------------------------

export async function ensureDefaultSettings(uid) {
  const ref = doc(db, "users", uid, "settings", "preferences");
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { theme: "dark" });
}

export async function getSettings(uid) {
  const ref = doc(db, "users", uid, "settings", "preferences");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : { theme: "dark" };
}

export async function updateSettings(uid, partial) {
  const ref = doc(db, "users", uid, "settings", "preferences");
  await setDoc(ref, partial, { merge: true });
}

// ---------------------------------------------------------------------------
// MEMORIES (users/{uid}/memories/{memoryId})
// ---------------------------------------------------------------------------
// Each user's memories live in their own subcollection so "every user owns
// only their own data" is enforced by firestore.rules, not just app logic.
// The Society drawer is the one public exception, read across every user's
// subcollection via a Firestore collectionGroup query.

export async function createMemory(uid, section, data) {
  const ref = await addDoc(collection(db, "users", uid, "memories"), {
    ...data,
    userId: uid,
    section,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getUserMemoriesBySection(uid, section) {
  const q = query(collection(db, "users", uid, "memories"), where("section", "==", section));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function getAllUserMemories(uid) {
  const q = query(collection(db, "users", uid, "memories"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPublicMemories(section = "society") {
  const q = query(
    collectionGroup(db, "memories"),
    where("section", "==", section),
    where("visibility", "==", "public")
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function updateMemory(uid, memoryId, data) {
  const ref = doc(db, "users", uid, "memories", memoryId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

export async function deleteMemory(uid, memoryId) {
  const ref = doc(db, "users", uid, "memories", memoryId);
  await deleteDoc(ref);
}
