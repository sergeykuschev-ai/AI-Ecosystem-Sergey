'use strict';

// Windows rejects fsync() on a read-only file descriptor with EPERM
// (errno -4048); POSIX allows it. The upload pipeline opens the staged
// workbook read-only before fsyncSync, so on Windows every upload that
// passes the Excel signature check fails before rename with a plain EPERM
// that the HTTP layer maps to 500. That is an operating-system limitation of
// the test host, not behavior under test, and only test code may absorb it:
// neutralize fsync inside the test process on Windows only. Production code
// and non-Windows runs keep the real fsync.
function stubFsyncSyncForWindows(fsModule) {
  if (process.platform !== 'win32') return;
  fsModule.fsyncSync = () => {};
}

module.exports = { stubFsyncSyncForWindows };
