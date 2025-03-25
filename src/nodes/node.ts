import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";

export async function node(
  nodeId: number, 
  N: number, 
  F: number, 
  initialValue: Value, 
  isFaulty: boolean, 
  nodesAreReady: () => boolean, 
  setNodeIsReady: (index: number) => void 
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0 
  };

  type NodeStateResponse = {
    killed: boolean;
    x: 0 | 1 | "?" | null;
    decided: boolean | null;
    k: number | null;
  };

  node.get("/status", (req, res) => {
    return isFaulty ? res.status(500).send("faulty") : res.status(200).send("live");
  });

  node.get("/getState", (req, res) => {
    return res.json(state);
  });

  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) return res.status(400).send("Nœud inactif");

    const { sender, value }: { sender: number, value: Value } = req.body;

    if (sender === undefined) {
      return res.status(400).send("Sender manquant dans la requête");
    }

    processMessage(sender, value);
    return res.status(200).send("Message reçu");
  });

  node.get("/start", async (req, res) => {
    if (isFaulty || state.killed) {
      return res.status(400).send("Nœud inactif");
    }

    startBenOrAlgorithm();
    return res.status(200).send("Algorithme lancé");
  });

  node.get("/stop", (req, res) => {
    state.killed = true;
    res.status(200).send("Nœud arrêté");
  });

  function processMessage(sender: number, value: Value) {
    if (state.killed || isFaulty) return;

    if (value !== null) {
      state.x = value;
    }
  }

  async function startBenOrAlgorithm() {
    if (state.killed) return;

    if (N === 1) {
      state.decided = true;
      return;
    }

    let receivedMessages = await collectMessages();

    let uniqueValues = new Set(receivedMessages);
    if (uniqueValues.size === 1 && (uniqueValues.has(0) || uniqueValues.has(1))) {
      state.x = uniqueValues.has(0) ? 0 : 1;
      state.decided = true;
      return;
    }

    for (; state.k !== null && state.k < 15; state.k++) {
      if (state.killed) return;

      receivedMessages = await collectMessages();
      let validMessages = receivedMessages.filter(v => v !== null);

      if (validMessages.length <= F) {
        state.decided = null;
        state.x = null;
        state.k = 11;
        return;
      }

      let newX = computeNewValue(validMessages);

      if (newX !== "?") {
        state.x = newX;
        state.decided = true;
        return;
      }
    }

    state.decided = null;
    state.x = null;
    state.k = 11;
  }

  async function collectMessages(): Promise<Value[]> {
    let messages: Value[] = [];

    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        try {
          let response = await fetch(`http://localhost:${BASE_NODE_PORT + i}/getState`);
          let data = (await response.json()) as NodeStateResponse;

          if (!data.killed && data.x !== null) {
            messages.push(data.x);
          }
        } catch (error) {
          console.log(`Erreur lors de la récupération de l'état du nœud ${i}`);
        }
      }
    }
    return messages;
  }

  function computeNewValue(messages: Value[]): Value {
    let zeroes = messages.filter(v => v === 0).length;
    let ones = messages.filter(v => v === 1).length;

    if (zeroes > ones && zeroes > messages.length / 2) return 0;
    if (ones > zeroes && ones > messages.length / 2) return 1;

    return "?";
  }

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Nœud ${nodeId} actif sur le port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
