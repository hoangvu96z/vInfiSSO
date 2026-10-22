import React from 'react';
import { Button, Modal } from 'antd';

export default function ConfirmActionButton({
  title,
  description,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy',
  onConfirm,
  children,
  buttonProps = {},
  disabled = false,
  danger = true,
}) {
  const openConfirmation = (event) => {
    event.stopPropagation();
    if (disabled) return;
    Modal.confirm({
      title,
      content: description,
      okText: confirmText,
      cancelText,
      okButtonProps: { danger },
      maskClosable: false,
      onOk: onConfirm,
    });
  };

  return (
    <Button {...buttonProps} disabled={disabled || buttonProps.disabled} onClick={openConfirmation}>
      {children}
    </Button>
  );
}
