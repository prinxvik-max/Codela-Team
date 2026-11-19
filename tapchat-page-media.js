/* TapChat Cloudinary + Firestore media integration */
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
  let firebaseSdk;
  let auth;
  let db;
  let currentUser = null;
  let initialization;

  function showToast(message) {
    let toast = document.getElementById("tapchatMediaToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tapchatMediaToast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.style.cssText = "position:fixed;z-index:99999;left:50%;bottom:24px;transform:translateX(-50%);background:#30271f;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90%;text-align:center";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.style.display = "none"; }, 3200);
  }

  function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
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
    return initialization;
  }

  async function waitForUser() {
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

  async function uploadFile(file) {
    if (!window.TapChatCloudinary) throw new Error("Cloudinary uploader is not loaded. Include cloudinary-media.js first.");
    return window.TapChatCloudinary.upload(file);
  }

  async function saveProfilePhoto(uploaded) {
    const user = await waitForUser();
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

    localStorage.setItem("tapchatProfilePhoto", uploaded.url);
    document.querySelectorAll("#sidebarPhoto, .profile-photo").forEach(image => {
      image.src = uploaded.url;
      image.hidden = false;
    });
  }

  function connectProfilePhotoInputs() {
    document.querySelectorAll("input[type='file'][id*='Photo'], input[type='file'][accept*='image']").forEach(input => {
      if (input.dataset.cloudinaryConnected) return;
      input.dataset.cloudinaryConnected = "true";
      input.accept = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
      input.addEventListener("change", async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
          showToast("Choose a JPG, JPEG, PNG, WEBP, or GIF profile picture.");
          input.value = "";
          return;
        }
        try {
          showToast("Uploading profile picture to Cloudinary...");
          const uploaded = await uploadFile(file);
          await saveProfilePhoto(uploaded);
          showToast("Profile picture saved to Cloudinary and Firestore.");
        } catch (error) {
          console.error("TapChat profile photo upload:", error);
          showToast(error.message || "Profile photo upload failed.");
        } finally {
          input.value = "";
        }
      }, true);
    });
  }

  function activeConversationId() {
    if (window.tapchatConversationId) return window.tapchatConversationId;
    const queryId = new URLSearchParams(location.search).get("conversationId");
    if (queryId) return queryId;
    const friendId = new URLSearchParams(location.search).get("friendId");
    const user = currentUser;
    if (friendId && user) return [user.uid, friendId].sort().join("__");
    return null;
  }

  async function saveChatMedia(uploaded, text = "") {
    const user = await waitForUser();
    const conversationId = activeConversationId();
    if (!conversationId) throw new Error("Select a private conversation before attaching media.");

    const { collection, doc, setDoc, serverTimestamp } = firebaseSdk.firestore;
    const messageRef = doc(collection(db, "conversations", conversationId, "messages"));
    const messageData = {
      senderId: user.uid,
      text,
      type: uploaded.resourceType === "video" ? "video" : uploaded.resourceType === "audio" ? "audio" : "image",
      mediaURL: uploaded.url,
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType,
      format: uploaded.format,
      bytes: uploaded.bytes,
      provider: "cloudinary",
      createdAt: serverTimestamp()
    };
    await setDoc(messageRef, messageData);
    await setDoc(doc(db, "conversations", conversationId), {
      lastMessage: text || `Shared ${uploaded.resourceType}`,
      lastMediaURL: uploaded.url,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { ...messageData, id: messageRef.id };
  }

  function appendMediaMessage(uploaded, text = "") {
    const area = document.getElementById("messagesArea") || document.getElementById("messageHistory");
    if (!area) return;
    const media = uploaded.resourceType === "video"
      ? Object.assign(document.createElement("video"), { controls: true, preload: "metadata", src: uploaded.url })
      : uploaded.resourceType === "audio"
        ? Object.assign(document.createElement("audio"), { controls: true, preload: "metadata", src: uploaded.url })
        : Object.assign(document.createElement("img"), { alt: "Shared media", src: uploaded.url });
    media.style.maxWidth = "min(360px, 100%)";
    media.style.borderRadius = "12px";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (text) {
      const caption = document.createElement("p");
      caption.textContent = text;
      bubble.appendChild(caption);
    }
    bubble.appendChild(media);
    const row = document.createElement("div");
    row.className = "message-row mine";
    row.appendChild(bubble);
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  }

  function addChatMediaControl() {
    const form = document.getElementById("messageForm") || document.querySelector(".message-composer");
    if (!form || document.getElementById("tapchatMediaInput")) return;
    const attach = document.createElement("button");
    attach.type = "button";
    attach.id = "tapchatMediaButton";
    attach.setAttribute("aria-label", "Attach media");
    attach.title = "Attach image, video, or audio";
    attach.textContent = "📎";
    attach.style.cssText = "border:0;background:transparent;font-size:18px;padding:8px;cursor:pointer";
    const input = document.createElement("input");
    input.type = "file";
    input.id = "tapchatMediaInput";
    input.accept = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg";
    input.hidden = true;
    attach.addEventListener("click", () => input.click());
    form.insertBefore(attach, form.firstChild);
    form.appendChild(input);
    input.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const textInput = document.getElementById("messageInput");
      const caption = textInput?.value.trim() || "";
      try {
        showToast("Uploading media to Cloudinary...");
        const uploaded = await uploadFile(file);
        await saveChatMedia(uploaded, caption);
        appendMediaMessage(uploaded, caption);
        if (textInput) textInput.value = "";
        showToast("Media URL saved to Firestore.");
      } catch (error) {
        console.error("TapChat chat media upload:", error);
        showToast(error.message || "Media upload failed.");
      } finally {
        input.value = "";
      }
    });
  }

  async function start() {
    try { await initialize(); }
    catch (error) { console.error("TapChat Firebase media setup:", error); }
    connectProfilePhotoInputs();
    addChatMediaControl();
    new MutationObserver(() => {
      connectProfilePhotoInputs();
      addChatMediaControl();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.TapChatMediaPage = { saveChatMedia, appendMediaMessage, showToast };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
