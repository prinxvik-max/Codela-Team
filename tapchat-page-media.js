/* Shared TapChat Cloudinary upload and Firestore persistence helpers. */
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
  const allowedMedia = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg";
  const allowedImages = ".jpg,.jpeg,.png,.webp,.gif";
  let firebaseSdk;
  let auth;
  let db;
  let currentUser = null;
  let initPromise;

  function toast(message) {
    let node = document.getElementById("tapchatMediaToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "tapchatMediaToast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.style.cssText = "position:fixed;z-index:99999;left:50%;bottom:24px;transform:translateX(-50%);background:#30271f;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90%;text-align:center";
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.style.display = "none"; }, 3200);
  }

  function initialize() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const appSdk = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js");
      const authSdk = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
      const firestore = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js");
      const app = appSdk.getApps().find(item => item.options.projectId === firebaseConfig.projectId)
        || appSdk.initializeApp(firebaseConfig, "tapchat-media");
      auth = authSdk.getAuth(app);
      db = firestore.getFirestore(app);
      firebaseSdk = { authSdk, firestore };
      authSdk.onAuthStateChanged(auth, user => { currentUser = user; });
    })();
    return initPromise;
  }

  async function requireUser() {
    await initialize();
    if (currentUser) return currentUser;
    return new Promise((resolve, reject) => {
      const unsubscribe = firebaseSdk.authSdk.onAuthStateChanged(auth, user => {
        unsubscribe();
        if (user) resolve(user);
        else reject(new Error("Please sign in before uploading media."));
      }, reject);
    });
  }

  function assertCloudinary() {
    if (!window.TapChatCloudinary) {
      throw new Error("Cloudinary uploader is missing. Load cloudinary-media.js before tapchat-page-media.js.");
    }
  }

  async function upload(file) {
    if (!file) throw new Error("Choose a media file first.");
    assertCloudinary();
    return window.TapChatCloudinary.upload(file);
  }

  async function saveProfilePhoto(uploaded) {
    const user = await requireUser();
    const { doc, setDoc, serverTimestamp } = firebaseSdk.firestore;
    await setDoc(doc(db, "users", user.uid), {
      photoURL: uploaded.url,
      photoPublicId: uploaded.publicId,
      photoResourceType: uploaded.resourceType,
      photoFormat: uploaded.format,
      photoBytes: uploaded.bytes,
      mediaProvider: "cloudinary",
      updatedAt: serverTimestamp()
    }, { merge: true });
    document.querySelectorAll("#sidebarPhoto, .profile-photo").forEach(image => {
      image.src = uploaded.url;
      image.hidden = false;
    });
    return uploaded.url;
  }

  function getActiveConversationId() {
    if (typeof window.tapchatConversationId === "string" && window.tapchatConversationId) {
      return window.tapchatConversationId;
    }
    const query = new URLSearchParams(window.location.search);
    const explicitId = query.get("conversationId");
    if (explicitId) return explicitId;
    const friendId = query.get("friendId");
    if (friendId && currentUser) return [currentUser.uid, friendId].sort().join("__");
    return null;
  }

  async function saveChatMedia(uploaded, caption = "") {
    const user = await requireUser();
    const conversationId = getActiveConversationId();
    if (!conversationId) throw new Error("Select a private conversation before attaching media.");
    const { collection, doc, setDoc, serverTimestamp } = firebaseSdk.firestore;
    const messageRef = doc(collection(db, "conversations", conversationId, "messages"));
    const type = uploaded.resourceType === "video" ? "video"
      : uploaded.resourceType === "audio" ? "audio" : "image";
    const message = {
      senderId: user.uid,
      text: caption,
      type,
      mediaURL: uploaded.url,
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType,
      format: uploaded.format,
      bytes: uploaded.bytes,
      provider: "cloudinary",
      createdAt: serverTimestamp()
    };
    await setDoc(messageRef, message);
    await setDoc(doc(db, "conversations", conversationId), {
      lastMessage: caption || `Shared ${type}`,
      lastMediaURL: uploaded.url,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { ...message, id: messageRef.id };
  }

  function appendMedia(uploaded, caption = "") {
    const area = document.getElementById("messagesArea") || document.getElementById("messageHistory");
    if (!area) return;
    const element = uploaded.resourceType === "video"
      ? Object.assign(document.createElement("video"), { controls: true, preload: "metadata", src: uploaded.url })
      : uploaded.resourceType === "audio"
        ? Object.assign(document.createElement("audio"), { controls: true, preload: "metadata", src: uploaded.url })
        : Object.assign(document.createElement("img"), { alt: "Shared media", src: uploaded.url });
    element.style.maxWidth = "min(360px, 100%)";
    element.style.borderRadius = "12px";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (caption) {
      const text = document.createElement("p");
      text.textContent = caption;
      bubble.appendChild(text);
    }
    bubble.appendChild(element);
    const row = document.createElement("div");
    row.className = "message-row mine";
    row.appendChild(bubble);
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  }

  function connectProfilePhotoInputs() {
    document.querySelectorAll("input[type='file'][id*='Photo'], input[type='file'][accept*='image']").forEach(input => {
      if (input.dataset.tapchatConnected) return;
      input.dataset.tapchatConnected = "true";
      input.accept = allowedImages;
      input.addEventListener("change", async event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          toast("Uploading profile picture...");
          const uploaded = await upload(file);
          await saveProfilePhoto(uploaded);
          toast("Profile picture saved to Cloudinary and Firestore.");
        } catch (error) {
          console.error("Profile photo upload failed:", error);
          toast(error.message || "Profile photo upload failed.");
        } finally {
          input.value = "";
        }
      }, true);
    });
  }

  function connectChatAttachment() {
    const form = document.getElementById("messageForm") || document.querySelector(".message-composer");
    if (!form || document.getElementById("tapchatMediaInput")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "tapchatMediaButton";
    button.textContent = "📎";
    button.title = "Attach image, video, or audio";
    button.setAttribute("aria-label", button.title);
    button.style.cssText = "border:0;background:transparent;font-size:18px;padding:8px;cursor:pointer";
    const picker = document.createElement("input");
    picker.type = "file";
    picker.id = "tapchatMediaInput";
    picker.accept = allowedMedia;
    picker.hidden = true;
    button.addEventListener("click", () => picker.click());
    form.insertBefore(button, form.firstChild);
    form.appendChild(picker);
    picker.addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const textInput = document.getElementById("messageInput");
      const caption = textInput && textInput.value ? textInput.value.trim() : "";
      try {
        toast("Uploading media to Cloudinary...");
        const uploaded = await upload(file);
        await saveChatMedia(uploaded, caption);
        appendMedia(uploaded, caption);
        if (textInput) textInput.value = "";
        toast("Media URL saved to Firestore.");
      } catch (error) {
        console.error("Chat media upload failed:", error);
        toast(error.message || "Media upload failed.");
      } finally {
        picker.value = "";
      }
    });
  }

  function start() {
    initialize().catch(error => console.error("TapChat Firebase media setup failed:", error));
    connectProfilePhotoInputs();
    connectChatAttachment();
    new MutationObserver(() => {
      connectProfilePhotoInputs();
      connectChatAttachment();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.TapChatMediaPage = { upload, saveProfilePhoto, saveChatMedia, appendMedia, toast };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
