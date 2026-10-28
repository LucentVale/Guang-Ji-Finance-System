// Error yang pesannya aman ditampilkan ke pengguna, lengkap dengan HTTP status.
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const badRequest = (message) => new AppError(400, message);
const notFound = (message = 'Data tidak ditemukan') => new AppError(404, message);
const conflict = (message) => new AppError(409, message);

module.exports = { AppError, badRequest, notFound, conflict };
