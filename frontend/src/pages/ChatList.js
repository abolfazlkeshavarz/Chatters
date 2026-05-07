import { useEffect, useState } from "react";
import { createChat, getChats } from "../api/chats";
import Chat from "./Chat";

// List of users who should see the notification button
const USERS_WITH_NOTIFICATION = ["abolam"];

export default function ChatList() {
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [activeTitle, setActiveTitle] = useState("");
  const [username, setUsername] = useState("");
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [showNotification, setShowNotification] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [selectedChatMembers, setSelectedChatMembers] = useState([]);
  const [selectedChatInfo, setSelectedChatInfo] = useState(null);

  const me = localStorage.getItem("username");

  useEffect(() => {
    loadChats();
  }, []);

  function loadChats() {
    getChats()
      .then(data => setChats(data || []))
      .catch(() => setError("Failed to load chats"));
  }

  const shouldShowNotificationButton = () => {
    return USERS_WITH_NOTIFICATION.includes(me);
  };

  async function handleCreateChat() {
    setError("");

    if (!username.trim()) {
      setError("Enter a username");
      return;
    }

    try {
      let members = username.trim().split(",").map(m => m.trim()).filter(m => m);
      await createChat(members, false);
      setUsername("");
      loadChats();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateGroup() {
    setError("");

    if (!username.trim()) {
      setError("Enter at least one username");
      return;
    }

    try {
      let members = username.trim().split(",").map(m => m.trim()).filter(m => m);
      await createChat(members, true, groupName.trim() || undefined);
      setUsername("");
      setGroupName("");
      setShowGroupModal(false);
      loadChats();
    } catch (err) {
      setError(err.message);
    }
  }

  function openChat(chat) {
    const others = chat.members.filter(u => u !== me);
    let title = "";
    
    if (chat.is_group) {
      // Use group name if exists, otherwise fallback to members list
      title = chat.name || others.map(member => member).join(", ");
    } else {
      title = others[0] || "You";
    }

    setActiveChat(chat.id);
    setActiveTitle(title);
  }

  // async function handleViewMembers(chat, e) {
  //   if (e) e.stopPropagation();
    
  //   try {
  //     const data = await getChatMembers(chat.id);
  //     setSelectedChatMembers(data.members);
  //     setSelectedChatInfo({
  //       isGroup: data.is_group,
  //       groupName: data.group_name,
  //       chatId: chat.id
  //     });
  //     setShowMembersModal(true);
  //   } catch (err) {
  //     setError("Failed to load members");
  //   }
  // }

  // Format timestamp like Telegram
  function formatTime(timestamp) {
    if (!timestamp) return "";
    
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      // Just now
      if (diffMins < 1) {
        return "Just now";
      }
      // Minutes ago
      if (diffMins < 60) {
        return `${diffMins}m`;
      }
      // Today
      if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      // Yesterday
      if (diffDays === 1) {
        return "Yesterday";
      }
      // Within last week
      if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' });
      }
      // Older than a week
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (error) {
      return "";
    }
  }

  if (activeChat) {
    return (
      <Chat
        chatId={activeChat}
        title={activeTitle}
        onBack={() => {
          setActiveChat(null);
          setActiveTitle("");
          loadChats(); // refresh unread dots
        }}
      />
    );
  }

  return (
    <div style={styles.page}>
      {/* Group Members Modal */}
      {showMembersModal && selectedChatInfo && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0 }}>
                {selectedChatInfo.isGroup 
                  ? (selectedChatInfo.groupName || "Group Members")
                  : "Chat Members"}
              </h3>
              <button 
                style={styles.modalClose}
                onClick={() => {
                  setShowMembersModal(false);
                  setSelectedChatMembers([]);
                  setSelectedChatInfo(null);
                }}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalContent}>
              <div style={styles.memberCount}>
                {selectedChatMembers.length} member{selectedChatMembers.length !== 1 ? 's' : ''}
              </div>
              <div style={styles.memberList}>
                {selectedChatMembers.map((member, index) => (
                  <div key={index} style={styles.memberItem}>
                    <div style={styles.memberAvatar}>
                      {member[0]?.toUpperCase()}
                    </div>
                    <div style={styles.memberInfo}>
                      <div style={styles.memberName}>
                        {member}
                        {member === me && (
                          <span style={styles.youBadge}> (You)</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                style={styles.closeModalButton}
                onClick={() => {
                  setShowMembersModal(false);
                  setSelectedChatMembers([]);
                  setSelectedChatInfo(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showGroupModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0 }}>Create Group</h3>
              <button 
                style={styles.modalClose}
                onClick={() => setShowGroupModal(false)}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalContent}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Group Name (optional)</label>
                <input
                  style={styles.input}
                  placeholder="e.g., Friends Group"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                />
                <div style={styles.hint}>
                  Leave empty for auto-generated name
                </div>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Add Members (comma separated)</label>
                <input
                  style={styles.input}
                  placeholder="user1, user2, user3"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
                <div style={styles.hint}>
                  Don't include your own username
                </div>
              </div>
              {error && <div style={styles.error}>{error}</div>}
              <div style={styles.modalActions}>
                <button 
                  style={styles.secondaryButton}
                  onClick={() => setShowGroupModal(false)}
                >
                  Cancel
                </button>
                <button 
                  style={styles.primaryButton}
                  onClick={handleCreateGroup}
                >
                  Create Group
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Critical Notification Modal */}
      {showNotification && (
        <div style={styles.notificationOverlay}>
          <div style={styles.notificationModal}>
            <div style={styles.notificationContent}>
              <div style={styles.notificationIcon}>⚠️</div>
              <div style={styles.notificationText}>
                سلام {me}، این نوتیف دقیقا برای شماست
               🙏 سه شنبه با غزل کاری نداشته باش
              </div>
              <button
                style={styles.notificationClose}
                onClick={() => setShowNotification(false)}
              >
                فهمیدم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerContent}>
          <h2 style={{ margin: 0 }}>Chats</h2>
          <div style={styles.subtext}>
            Logged in as <strong>{me}</strong>
          </div>
          
          {/* دیدن اعلان button - only shows for specific users */}
          {shouldShowNotificationButton() && (
            <button 
              style={styles.announceButton}
              onClick={() => setShowNotification(true)}
            >
             اعلان بسیار مهم
            </button>
          )}
        </div>
      </div>

      {/* Create chat buttons */}
      <div style={styles.createButtons}>
        <div style={styles.createBox}>
          <input
            style={styles.input}
            placeholder="آیدی خودتو نزن! آیدی مخاطباتو بزن"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          <button style={styles.button} onClick={handleCreateChat}>
            ساخت چت
          </button>
        </div>
        <button 
          style={styles.groupButton}
          onClick={() => setShowGroupModal(true)}
        >
          + Create Group
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Chat list */}
      <div style={styles.list}>
        {(!chats || chats.length === 0) && (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>💬</div>
            <div style={styles.emptyText}>No chats yet</div>
            <div style={styles.emptySubtext}>Start a conversation!</div>
          </div>
        )}

        {chats.map(chat => {
          const others = chat.members.filter(u => u !== me);
          const title = chat.is_group
            ? (chat.name || others.join(", "))
            : others[0] || "You";

          // Determine last message preview
          let lastMessagePreview = "";
          let showSender = false;
          
          if (chat.last_message) {
            if (chat.last_message_sender === me) {
              lastMessagePreview = `You: ${chat.last_message}`;
            } else if (chat.is_group && chat.last_message_sender) {
              lastMessagePreview = `${chat.last_message_sender}: ${chat.last_message}`;
              showSender = true;
            } else {
              lastMessagePreview = chat.last_message;
            }
          } else {
            lastMessagePreview = "No messages yet";
          }

          // Truncate long messages
          if (lastMessagePreview.length > 35) {
            lastMessagePreview = lastMessagePreview.substring(0, 32) + "...";
          }

          return (
            <div
              key={chat.id}
              onClick={() => openChat(chat)}
              style={{
                ...styles.chatCard,
                backgroundColor: chat.unread_count > 0 ? "var(--unread-bg)" : "var(--card)"
              }}
            >
              <div style={styles.avatar}>
                {title[0]?.toUpperCase()}
                {chat.unread_count > 0 && (
                  <div style={styles.avatarUnreadIndicator} />
                )}
              </div>

              <div style={styles.chatContent}>
                <div style={styles.chatHeader}>
                  <div style={styles.chatTitle}>
                    {title}
                    {chat.is_group && (
                      <span style={styles.groupBadge}>Group</span>
                    )}
                  </div>
                  <div style={styles.timestamp}>
                    {formatTime(chat.last_message_time)}
                  </div>
                </div>
                
                <div style={styles.chatFooter}>
                  <div style={{
                    ...styles.lastMessage,
                    fontWeight: chat.unread_count > 0 ? "bold" : "normal",
                    color: chat.unread_count > 0 ? "var(--text)" : "var(--subtext)"
                  }}>
                    {lastMessagePreview}
                  </div>
                  
                  {chat.unread_count > 0 && (
                    <div style={styles.unreadBadge}>
                      {chat.unread_count > 9 ? "9+" : chat.unread_count}
                    </div>
                  )}
                  
                  {chat.unread_count === 0 && chat.last_message_sender === me && (
                    <div style={styles.sentIcon}>✓</div>
                  )}
                </div>
              </div>

              {/* View Members Button for Groups */}
              {/*
              {chat.is_group && (
                <button
                  style={styles.viewMembersButton}
                  onClick={(e) => handleViewMembers(chat, e)}
                  title="View Members"
                >
                  👥
                </button>
              )}*/}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 520,
    margin: "0 auto",
    padding: 16,
    position: "relative",
    backgroundColor: "var(--background)",
    minHeight: "100vh",
  },
  header: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottom: "1px solid var(--border)",
  },
  headerContent: {
    position: "relative",
  },
  subtext: {
    fontSize: 13,
    color: "var(--subtext)",
    marginBottom: 12,
  },
  
  // دیدن اعلان button styles
  announceButton: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: "#ff3b30",
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
    cursor: "pointer",
    marginTop: 8,
    width: "100%",
    transition: "opacity 0.2s",
  },
  
  // Notification modal styles
  notificationOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  notificationModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    maxWidth: 400,
    width: "100%",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
  },
  notificationContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },
  notificationIcon: {
    fontSize: 40,
  },
  notificationText: {
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    color: "#d9534f",
    lineHeight: 1.5,
    direction: "rtl",
  },
  notificationClose: {
    backgroundColor: "#007aff",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    minWidth: 100,
    transition: "opacity 0.2s",
  },

  createButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 20,
  },

  createBox: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    backgroundColor: "var(--card)",
    borderRadius: 16,
    border: "1px solid var(--border)",
  },

  groupButton: {
    padding: "12px 16px",
    borderRadius: 12,
    border: "2px dashed var(--border)",
    background: "transparent",
    color: "var(--primary)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    ":hover": {
      backgroundColor: "var(--primary)",
      color: "#fff",
    },
  },

  input: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    fontSize: 15,
    backgroundColor: "var(--background)",
    color: "var(--text)",
    outline: "none",
  },
  button: {
    padding: "12px 20px",
    borderRadius: 12,
    border: "none",
    background: "var(--primary)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.2s",
    ":hover": {
      opacity: 0.9,
    },
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  chatCard: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
    border: "1px solid var(--border)",
    cursor: "pointer",
    transition: "all 0.2s",
    ":hover": {
      transform: "translateY(-1px)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
    },
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    color: "#fff",
    fontSize: 20,
    position: "relative",
    flexShrink: 0,
  },
  avatarUnreadIndicator: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    backgroundColor: "#ff3b30",
    border: "2px solid var(--card)",
  },
  chatContent: {
    flex: 1,
    minWidth: 0, // Important for text truncation
  },
  chatHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  groupBadge: {
    fontSize: 10,
    fontWeight: "bold",
    backgroundColor: "var(--primary)",
    color: "#fff",
    padding: "2px 6px",
    borderRadius: 4,
    opacity: 0.8,
  },
  timestamp: {
    fontSize: 12,
    color: "var(--subtext)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    marginLeft: 8,
  },
  chatFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  lastMessage: {
    fontSize: 14,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: "#ff3b30",
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    borderRadius: 12,
    minWidth: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    marginLeft: 8,
    flexShrink: 0,
  },
  sentIcon: {
    color: "var(--subtext)",
    fontSize: 14,
    marginLeft: 8,
    opacity: 0.7,
  },
  empty: {
    textAlign: "center",
    color: "var(--subtext)",
    marginTop: 80,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: 500,
  },
  emptySubtext: {
    fontSize: 14,
    opacity: 0.7,
  },
  error: {
    color: "#ff3b30",
    marginBottom: 12,
    fontSize: 14,
    backgroundColor: "rgba(255, 59, 48, 0.1)",
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255, 59, 48, 0.2)",
  },

  // Modal styles
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    backgroundColor: "var(--card)",
    borderRadius: 16,
    maxWidth: 400,
    width: "100%",
    maxHeight: "80vh",
    overflow: "hidden",
    border: "1px solid var(--border)",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
  },
  modalHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "var(--background)",
  },
  modalClose: {
    background: "transparent",
    border: "none",
    fontSize: 20,
    cursor: "pointer",
    color: "var(--subtext)",
    padding: 4,
    borderRadius: "50%",
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    ":hover": {
      backgroundColor: "rgba(0, 0, 0, 0.1)",
    },
  },
  modalContent: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    marginBottom: 8,
    fontSize: 14,
    color: "var(--text)",
    fontWeight: 500,
  },
  hint: {
    fontSize: 12,
    color: "var(--subtext)",
    marginTop: 4,
    marginBottom: 8,
  },
  modalActions: {
    display: "flex",
    gap: 12,
    marginTop: 20,
  },
  primaryButton: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "none",
    background: "var(--primary)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    ":hover": {
      opacity: 0.9,
    },
  },
  secondaryButton: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    ":hover": {
      backgroundColor: "rgba(0, 0, 0, 0.05)",
    },
  },
  viewMembersButton: {
    background: "transparent",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    padding: "8px",
    borderRadius: "50%",
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--subtext)",
    flexShrink: 0,
    ":hover": {
      backgroundColor: "rgba(0, 0, 0, 0.1)",
    },
  },
  memberCount: {
    fontSize: 14,
    color: "var(--subtext)",
    marginBottom: 16,
    textAlign: "center",
  },
  memberList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 20,
  },
  memberItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 0",
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    color: "#fff",
    fontSize: 16,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: 500,
    color: "var(--text)",
  },
  youBadge: {
    fontSize: 14,
    color: "var(--primary)",
    opacity: 0.8,
  },
  closeModalButton: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    ":hover": {
      backgroundColor: "rgba(0, 0, 0, 0.05)",
    },
  },
};