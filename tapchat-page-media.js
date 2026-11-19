/* TapChat page integration for Cloudinary uploads and Firestore URLs */
(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyCWa9XkYkmmEpsqFdmSWIhArKt2Cj_8TSY",
    authDomain: "tapchat-d77e7.firebaseapp.com",
    projectId: "tapchat-d77e7",
    storageBucket: "tapchat-d77e7.firebasestorage.app",
    messagingSenderId: "309292071078",
    appId: "1:309292071078:web:532d9cf0f8f7632f965c67",
    measurementId: "G-D752JEHRC8"
  };

  const allowedAccept = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg";
  let firebase = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let toastTimer = null;

  function showToast(message) {
    let toast = document.getElementById("tapchatMediaToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tapchatMediaToast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.style.cssText = "position:fixed;z-index:99999;left:50%;bottom:24px;transform:translateX(-50%);background:#30271f;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2)";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, 3200);
  }

  async function initializeFirebase() {
    if (firebase) return;
    const appModule = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js");
    const authModule = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
    const firestoreModule = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js");

    firebase = { appModule, authModule, firestoreModule };
    const existingApps = appModule.getApps ? appModule.getApps() : [];
    const app = existingApps[0] || appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db = firestoreModule.getFirestore(app);

    authModule.onAuthStateChanged(auth, user => {
      currentUser = user;
      if (user) connectProfilePhotos(user);
    });
  }

  async function uploadFile(file) {
    if (!window.TapChatCloudinary) throw new Error("Cloudinary integration is not loaded.");
    return window.TapChatCloudinary.upload(file);
  }

  async function saveProfilePhoto(upload) {
    if (!currentUser) throw new Error("Please sign in before changing your profile picture.");
    const { doc, setDoc, serverTimestamp } = firebase.firestoreModule;
    await setDoc(doc(db, "users", currentUser.uid), {
      photoURL: upload.url,
      photoPublicId: upload.publicId,
      photoResourceType: upload.resourceType,
      photoFormat: upload.format,
      photoBytes: upload.bytes,
      mediaProvider: "cloudinary",
      updatedAt: serverTimestamp()
    }, { merge: true });

    localStorage.setItem("tapchatProfilePhoto", upload.url);
    document.querySelectorAll("img").forEach(img => {
      if (img.id === "sidebarPhoto" || img.classList.contains("profile-photo")) {
        img.src = upload.url;
        img.hidden = false;
      }
    });
  }

  function connectProfilePhotos(user) {
    const inputs = document.querySelectorAll("input[type='file']");
    inputs.forEach(input => {
      if (input.dataset.tapchatMediaConnected) return;
      input.dataset.tapchatMediaConnected = "true";
      input.setAttribute("accept", "image/jpeg,image/png,image/webp,image/gif");

      input.addEventListener("change", async event => {
        event.stopImmediatePropagation();
        event.preventEventDefault?.();
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          showToast("Choose a JPG, JPEG, PNG, WEBP, or GIF profile picture.");
          input.value = "";
          return;
        }

        try {
          showToast("Uploading profile picture...");
          const upload = await uploadFile(file);
          await saveProfilePhoto(upload);
          showToast("Profile picture saved to Cloudinary and Firestore.");
        } catch (error) {
          console.error(error);
          showToast(error.message || "Profile picture upload failed.");
        } finally {
          input.value = "";
        }
      }, true);
    });
  }

  async function saveChatMedia(upload, text) {
    if (!currentUser) throw new Error("Please sign in before sending media.");

    const friendId = new URLSearchParams(window.location.search).get("friendId");
    if (!friendId) throw new Error("Open a confirmed private conversation before sending media.");

    const { doc, collection, addDoc, setDoc, serverTimestamp } = firebase.firestoreModule;
    const conversationId = [currentUser.uid, friendId].sort().join("__");

    await addDoc(collection(db, "conversations", conversationId, "messages"), {
      senderId: currentUser.uid,
      text: text || "",
      type: upload.resourceType === "video" ? "video" : upload.resourceType === "audio" ? "audio" : "image",
      mediaURL: upload.url,
      publicId: upload.publicId,
      resourceType: upload.resourceType,
      format: upload.format,
      bytes: upload.bytes,
      provider: "cloudinary",
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db, "conversations", conversationId), {
      participants: [currentUser.uid, friendId].sort(),
      lastMessage: text || `Shared ${upload.resourceType}`,
      lastMediaURL: upload.url,
      updatedAt: serverTimestamp()
    }, { merge: true });

    return upload.url;
  }

  function addChatMediaControls() {
    const composerForm = document.getElementById("messageForm");
    if (!composerForm || document.getElementById("tapchatMediaInput")) return;

    const attachButton = document.createElement("button");
    attachButton.type = "button";
    attachButton.id = "tapchatMediaButton";
    attachButton.setAttribute("aria-label", "Attach media");
    attachButton.textContent = "📎";
    attachButton.style.cssText = "border:0;background:transparent;font-size:18px;padding:8px;cursor:pointer";

    const mediaInput = document.createElement("input");
    mediaInput.type = "file";
    mediaInput.id = "tapchatMediaInput";
    mediaInput.accept = allowedAccept;
    mediaInput.hidden = true;

    attachButton.addEventListener("click", () => mediaInput.click());

    composerForm.insertBefore(attachButton, composerForm.firstChild);
    composerForm.appendChild(mediaInput);

    mediaInput.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        showToast("Uploading media to Cloudinary...");
        const upload = await uploadFile(file);
        const text = document.getElementById("messageInput")?.value.trim() || "";
        await saveChatMedia(upload, text);
        const input = document.getElementById("messageInput");
        if (input) input.value = "";
        showToast("Media saved to Cloudinary and Firestore.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Media upload failed.");
      } finally {
        mediaInput.value = "";
      }
    });
  }

  async function start() {
    await initializeFirebase();
    addChatMediaControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
