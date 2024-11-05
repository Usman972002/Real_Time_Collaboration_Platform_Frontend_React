import React, { useCallback, useEffect, useState,useRef } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import { useParams } from "react-router-dom";
import { Client } from "@stomp/stompjs";
import { throttle } from "lodash";

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  [{ font: [] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["bold", "italic", "underline"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  ["image", "blockquote", "code-block"],
  ["clean"],
];

const SAVE_INTERVAL_MS = 2000;

const TextEditor = () => {
  const BASEURL = import.meta.env.VITE_REACT_APP_BASEURL;
  const { id: documentId } = useParams();
  const [stompClient, setStompClient] = useState(null);
  const [quill, setQuill] = useState(null);
  const appliedDeltas = useRef(new Set()); // Track applied deltas

  // Initialize STOMP client and set up subscriptions
  useEffect(() => {
    const client = new Client({
      brokerURL: `${BASEURL}/websocket`,
      reconnectDelay: 5000,
      onConnect: () => {
        // console.log("Connected to WebSocket");

        // Subscribe to document change updates
        client.subscribe(`/topic/document/${documentId}`, (message) => {
          const delta = JSON.parse(message.body);

          // Apply only if delta is new
          const deltaKey = JSON.stringify(delta);
          if (!appliedDeltas.current.has(deltaKey)) {
            appliedDeltas.current.add(deltaKey);
            quill && quill.updateContents(delta);
          }
        });

        client.subscribe(`/topic/document/${documentId}/load`, (message) => {
            const documentData = JSON.parse(message.body);
            // console.log("Received document data:", documentData);
        
            // Parse the data field to extract ops
            const documentDataParsed = JSON.parse(documentData?.data);
            // console.log("Parsed document ops:", documentDataParsed.ops);
        
            const contents = documentDataParsed?.ops; // Now accessing ops from the parsed data
        
            if (quill) {
                quill.setContents(contents);
                quill.enable();
            }
        });


        // Request the document to load initially
        client.publish({ destination: `/app/document/${documentId}/load` });
        setStompClient(client);
      },
      debug: (str) => console.log(str),
    });

    client.activate();

    return () => {
      client.deactivate();
    };
  }, [documentId, quill]);

  // Throttled function for sending changes
  const sendChanges = throttle((delta) => {
    const deltaKey = JSON.stringify(delta);
    if (!appliedDeltas.current.has(deltaKey)) {
      appliedDeltas.current.add(deltaKey);
      stompClient.publish({
        destination: `/app/document/${documentId}/edit`,
        body: deltaKey,
      });
    }
  }, 10);

  // Send document changes to server
  useEffect(() => {
    if (!stompClient || !quill) return;

    const onTextChange = (delta, oldDelta, source) => {
      if (source === "user") {
        sendChanges(delta);
      }
    };

    quill.on("text-change", onTextChange);

    return () => {
      quill.off("text-change", onTextChange);
    };
  }, [stompClient, quill, documentId]);

  // Periodic auto-save
  useEffect(() => {
    if (!stompClient || !quill) return;

    const interval = setInterval(() => {
      stompClient.publish({
        destination: `/app/document/${documentId}/save`,
        body: JSON.stringify(quill.getContents()),
      });
    }, SAVE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [stompClient, quill, documentId]);

  // Initialize Quill editor
  const wrapperRef = useCallback((wrapper) => {
    if (!wrapper) return;

    wrapper.innerHTML = "";
    const editor = document.createElement("div");
    wrapper.append(editor);
    const q = new Quill(editor, {
      theme: "snow",
      modules: { toolbar: TOOLBAR_OPTIONS },
    });
    q.disable();
    q.setText("Loading...");
    setQuill(q);
  }, []);

  return <div className="container" ref={wrapperRef}></div>;
};

export default TextEditor;

