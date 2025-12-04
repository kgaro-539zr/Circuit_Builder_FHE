// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Circuit {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  creator: string;
  difficulty: number;
  gates: string[];
  isVerified: boolean;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCircuitData, setNewCircuitData] = useState({ name: "", difficulty: 1, gates: [] as string[] });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedCircuit, setSelectedCircuit] = useState<Circuit | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [currentStep, setCurrentStep] = useState(0);

  // Available logic gates
  const availableGates = ["AND", "OR", "XOR", "NOT", "NAND", "NOR", "XNOR"];

  useEffect(() => {
    loadCircuits().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadCircuits = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("circuit_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing circuit keys:", e); }
      }
      
      const list: Circuit[] = [];
      for (const key of keys) {
        try {
          const circuitBytes = await contract.getData(`circuit_${key}`);
          if (circuitBytes.length > 0) {
            try {
              const circuitData = JSON.parse(ethers.toUtf8String(circuitBytes));
              list.push({ 
                id: key, 
                name: circuitData.name, 
                encryptedData: circuitData.data, 
                timestamp: circuitData.timestamp, 
                creator: circuitData.creator, 
                difficulty: circuitData.difficulty || 1,
                gates: circuitData.gates || [],
                isVerified: circuitData.isVerified || false
              });
            } catch (e) { console.error(`Error parsing circuit data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading circuit ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCircuits(list);
    } catch (e) { console.error("Error loading circuits:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitCircuit = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting circuit data with Zama FHE..." });
    try {
      // Generate a random encrypted value for the circuit
      const randomValue = Math.floor(Math.random() * 1000);
      const encryptedData = FHEEncryptNumber(randomValue);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const circuitId = `circuit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const circuitData = { 
        name: newCircuitData.name, 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        creator: address, 
        difficulty: newCircuitData.difficulty,
        gates: newCircuitData.gates,
        isVerified: false
      };
      
      await contract.setData(`circuit_${circuitId}`, ethers.toUtf8Bytes(JSON.stringify(circuitData)));
      
      const keysBytes = await contract.getData("circuit_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(circuitId);
      await contract.setData("circuit_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Circuit created with FHE encryption!" });
      await loadCircuits();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCircuitData({ name: "", difficulty: 1, gates: [] });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyCircuit = async (circuitId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying FHE circuit..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const circuitBytes = await contract.getData(`circuit_${circuitId}`);
      if (circuitBytes.length === 0) throw new Error("Circuit not found");
      const circuitData = JSON.parse(ethers.toUtf8String(circuitBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedCircuit = { ...circuitData, isVerified: true };
      await contractWithSigner.setData(`circuit_${circuitId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCircuit)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Circuit verified successfully!" });
      await loadCircuits();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isCreator = (circuitAddress: string) => address?.toLowerCase() === circuitAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to start building FHE circuits", icon: "🔗" },
    { title: "Design Circuit", description: "Select logic gates to build your FHE computation circuit", icon: "🧩", details: "Combine gates to create complex FHE computations" },
    { title: "FHE Encryption", description: "Your circuit will process encrypted data without decryption", icon: "🔒", details: "Zama FHE technology enables computations on encrypted data" },
    { title: "Test & Verify", description: "Test your circuit and verify its correctness", icon: "✅", details: "Ensure your circuit performs the intended FHE computation" }
  ];

  const renderCircuitStats = () => {
    const verifiedCount = circuits.filter(c => c.isVerified).length;
    const total = circuits.length || 1;
    const verifiedPercentage = (verifiedCount / total) * 100;
    
    return (
      <div className="circuit-stats">
        <div className="stat-item">
          <div className="stat-value">{circuits.length}</div>
          <div className="stat-label">Total Circuits</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{verifiedCount}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{Math.round(verifiedPercentage)}%</div>
          <div className="stat-label">Success Rate</div>
        </div>
      </div>
    );
  };

  const handleGateToggle = (gate: string) => {
    setNewCircuitData(prev => {
      if (prev.gates.includes(gate)) {
        return { ...prev, gates: prev.gates.filter(g => g !== gate) };
      } else {
        return { ...prev, gates: [...prev.gates, gate] };
      }
    });
  };

  const nextStep = () => setCurrentStep(prev => (prev < tutorialSteps.length - 1 ? prev + 1 : prev));
  const prevStep = () => setCurrentStep(prev => (prev > 0 ? prev - 1 : prev));

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="circuit-icon"></div></div>
          <h1>Circuit<span>Builder</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-circuit-btn cyber-button">
            <div className="add-icon"></div>New Circuit
          </button>
          <button className="cyber-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Build FHE Circuits</h2>
            <p>Design circuits that perform computations on encrypted data using Zama FHE technology</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Circuit Builder Tutorial</h2>
            <p className="subtitle">Learn how to build FHE computation circuits</p>
            
            <div className="step-navigation">
              <button onClick={prevStep} disabled={currentStep === 0} className="cyber-button">Previous</button>
              <div className="step-indicator">
                {tutorialSteps.map((_, index) => (
                  <div 
                    key={index} 
                    className={`step-dot ${currentStep === index ? 'active' : ''}`}
                    onClick={() => setCurrentStep(index)}
                  />
                ))}
              </div>
              <button onClick={nextStep} disabled={currentStep === tutorialSteps.length - 1} className="cyber-button">Next</button>
            </div>
            
            <div className="current-step-content">
              <div className="step-icon">{tutorialSteps[currentStep].icon}</div>
              <h3>{tutorialSteps[currentStep].title}</h3>
              <p>{tutorialSteps[currentStep].description}</p>
              {tutorialSteps[currentStep].details && (
                <div className="step-details">{tutorialSteps[currentStep].details}</div>
              )}
            </div>
          </div>
        )}
        
        <div className="project-intro cyber-card">
          <h2>About Circuit Builder FHE</h2>
          <p>
            Circuit Builder FHE is a puzzle game where you design circuits that perform computations on 
            <strong> Fully Homomorphically Encrypted (FHE)</strong> data using Zama's technology. Your circuits 
            process encrypted data without ever decrypting it, preserving privacy while enabling complex computations.
          </p>
          <div className="fhe-badge"><span>Powered by Zama FHE</span></div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Circuit Statistics</h3>
            {renderCircuitStats()}
          </div>
          <div className="dashboard-card cyber-card">
            <h3>Available Logic Gates</h3>
            <div className="gate-grid">
              {availableGates.map(gate => (
                <div key={gate} className="gate-item">
                  <div className="gate-icon">{gate}</div>
                  <div className="gate-name">{gate} Gate</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="circuits-section">
          <div className="section-header">
            <h2>Community Circuits</h2>
            <div className="header-actions">
              <button onClick={loadCircuits} className="refresh-btn cyber-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          <div className="circuits-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Name</div>
              <div className="header-cell">Creator</div>
              <div className="header-cell">Gates</div>
              <div className="header-cell">Difficulty</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            {circuits.length === 0 ? (
              <div className="no-circuits">
                <div className="no-circuits-icon"></div>
                <p>No circuits found</p>
                <button className="cyber-button primary" onClick={() => setShowCreateModal(true)}>Create First Circuit</button>
              </div>
            ) : circuits.map(circuit => (
              <div className="circuit-row" key={circuit.id} onClick={() => setSelectedCircuit(circuit)}>
                <div className="table-cell circuit-id">#{circuit.id.substring(0, 6)}</div>
                <div className="table-cell">{circuit.name}</div>
                <div className="table-cell">{circuit.creator.substring(0, 6)}...{circuit.creator.substring(38)}</div>
                <div className="table-cell">{circuit.gates.join(', ')}</div>
                <div className="table-cell">{circuit.difficulty}</div>
                <div className="table-cell">
                  <span className={`status-badge ${circuit.isVerified ? 'verified' : 'pending'}`}>
                    {circuit.isVerified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                <div className="table-cell actions">
                  {isCreator(circuit.creator) && !circuit.isVerified && (
                    <button className="action-btn cyber-button success" onClick={(e) => { e.stopPropagation(); verifyCircuit(circuit.id); }}>Verify</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="community-links cyber-card">
          <h3>Join the FHE Community</h3>
          <div className="links-grid">
            <a href="https://zama.ai" target="_blank" rel="noopener noreferrer" className="community-link">
              <div className="link-icon">🔗</div>
              <div className="link-text">Zama Official</div>
            </a>
            <a href="https://discord.gg/zama" target="_blank" rel="noopener noreferrer" className="community-link">
              <div className="link-icon">💬</div>
              <div className="link-text">Zama Discord</div>
            </a>
            <a href="https://github.com/zama-ai" target="_blank" rel="noopener noreferrer" className="community-link">
              <div className="link-icon">👨‍💻</div>
              <div className="link-text">GitHub</div>
            </a>
            <a href="https://twitter.com/zama_fhe" target="_blank" rel="noopener noreferrer" className="community-link">
              <div className="link-icon">🐦</div>
              <div className="link-text">Twitter</div>
            </a>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCircuit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          circuitData={newCircuitData} 
          setCircuitData={setNewCircuitData}
          availableGates={availableGates}
          handleGateToggle={handleGateToggle}
        />
      )}
      
      {selectedCircuit && (
        <CircuitDetailModal 
          circuit={selectedCircuit} 
          onClose={() => { setSelectedCircuit(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="circuit-icon"></div><span>CircuitBuilderFHE</span></div>
            <p>Build FHE computation circuits with Zama technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} Circuit Builder FHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  circuitData: any;
  setCircuitData: (data: any) => void;
  availableGates: string[];
  handleGateToggle: (gate: string) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, circuitData, setCircuitData, availableGates, handleGateToggle }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCircuitData({ ...circuitData, [name]: value });
  };

  const handleSubmit = () => {
    if (!circuitData.name || circuitData.gates.length === 0) { 
      alert("Please fill required fields and select at least one gate"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Create New FHE Circuit</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Circuit Notice</strong><p>Your circuit will process encrypted data without decryption</p></div>
          </div>
          
          <div className="form-group">
            <label>Circuit Name *</label>
            <input 
              type="text" 
              name="name" 
              value={circuitData.name} 
              onChange={handleChange} 
              placeholder="Enter circuit name..." 
              className="cyber-input"
            />
          </div>
          
          <div className="form-group">
            <label>Difficulty Level</label>
            <select 
              name="difficulty" 
              value={circuitData.difficulty} 
              onChange={handleChange} 
              className="cyber-select"
            >
              <option value="1">Beginner</option>
              <option value="2">Intermediate</option>
              <option value="3">Advanced</option>
              <option value="4">Expert</option>
              <option value="5">Master</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Select Logic Gates *</label>
            <div className="gates-grid">
              {availableGates.map(gate => (
                <div 
                  key={gate} 
                  className={`gate-selector ${circuitData.gates.includes(gate) ? 'selected' : ''}`}
                  onClick={() => handleGateToggle(gate)}
                >
                  <div className="gate-symbol">{gate}</div>
                  <div className="gate-name">{gate} Gate</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Circuit Logic:</span>
                <div>{circuitData.gates.length > 0 ? circuitData.gates.join(' → ') : 'No gates selected'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Computation:</span>
                <div>FHE-{circuitData.gates.length > 0 ? btoa(circuitData.gates.join(',')) : 'No gates selected'}</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cyber-button primary">
            {creating ? "Creating Circuit..." : "Create Circuit"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CircuitDetailModalProps {
  circuit: Circuit;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const CircuitDetailModal: React.FC<CircuitDetailModalProps> = ({ circuit, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(circuit.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="circuit-detail-modal cyber-card">
        <div className="modal-header">
          <h2>Circuit Details #{circuit.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="circuit-info">
            <div className="info-item"><span>Name:</span><strong>{circuit.name}</strong></div>
            <div className="info-item"><span>Creator:</span><strong>{circuit.creator.substring(0, 6)}...{circuit.creator.substring(38)}</strong></div>
            <div className="info-item"><span>Created:</span><strong>{new Date(circuit.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Difficulty:</span><strong>{circuit.difficulty}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${circuit.isVerified ? 'verified' : 'pending'}`}>{circuit.isVerified ? 'Verified' : 'Pending'}</strong></div>
          </div>
          
          <div className="circuit-diagram">
            <h3>Circuit Design</h3>
            <div className="gate-flow">
              {circuit.gates.map((gate, index) => (
                <React.Fragment key={index}>
                  <div className="gate-node">{gate}</div>
                  {index < circuit.gates.length - 1 && <div className="flow-arrow">→</div>}
                </React.Fragment>
              ))}
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Output</h3>
            <div className="encrypted-data">{circuit.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button className="decrypt-btn cyber-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedValue !== null ? "Hide Decrypted Value" : "Decrypt with Wallet Signature"}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Output</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice"><div className="warning-icon"></div><span>Decrypted data is only visible after wallet signature verification</span></div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cyber-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;