import api from './config';

export const getPublicRoom = async () => {
  const response = await api.get('/api/public/rooms/main');
  return response.data;
};

export const getPublicMessages = async (roomId) => {
  const response = await api.get(`/api/public/rooms/${roomId}/messages`);
  return response.data;
};

export const sendPublicMessage = async (roomId, content) => {
  const response = await api.post(`/api/public/rooms/${roomId}/messages`, { content });
  return response.data;
};

export const uploadPublicMedia = async (roomId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('room_id', roomId);
  
  const response = await api.post(`/api/public/rooms/${roomId}/media`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};