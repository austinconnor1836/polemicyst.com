import React, { useState } from 'react';

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deletedLink: any) => void;
  id: string;
}

const DeleteModal: React.FC<DeleteModalProps> = ({ isOpen, onClose, onConfirm, id }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/links', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });

      if (response.ok) {
        const deletedLink = await response.json();
        console.log('Deleted link:', deletedLink);
        onConfirm(deletedLink);
      } else {
        console.error('Failed to delete link:', response.statusText);
      }
    } catch (error) {
      console.error('Error deleting link:', error);
    } finally {
      setIsLoading(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white p-4 rounded shadow-md w-96">
        <h2 className="text-xl mb-4">Are you sure you want to delete?</h2>
        <div className="flex justify-end">
          <button onClick={handleDelete} className="mr-2 p-2 bg-green-500 text-white rounded flex items-center" disabled={isLoading}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
            Yes
          </button>
          <button onClick={onClose} className="p-2 bg-red-500 text-white rounded flex items-center" disabled={isLoading}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteModal;