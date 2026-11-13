// Impor mutasi bank: upload -> preview -> commit. Upload & preview tidak mengubah data, jadi tidak dicatat.
module.exports = function register(router, { services }) {
  const base = '/api/fothang/:fothangId/imports';

  // Body berupa isi file .xlsx mentah; nama file dikirim lewat header X-Filename.
  router.post(`${base}/upload`, ({ params, req, rawBody }) => {
    const fileName = decodeURIComponent(req.headers['x-filename'] || 'mutasi.xlsx');
    return services.imports.upload(params.fothangId, rawBody, fileName);
  }, { rawBody: true, audit: false });

  router.post(`${base}/preview`, ({ params, body }) => ({ rows: services.imports.preview(params.fothangId, body) }), { audit: false });
  router.post(`${base}/commit`, ({ params, body }) => services.imports.commit(params.fothangId, body), { audit: 'Mengimpor mutasi bank' });

  // File DRAF Laporan Keuangan (upload memakai endpoint upload yang sama).
  router.post(`${base}/draf/preview`, ({ params, body }) => services.imports.previewDraf(params.fothangId, body), { audit: false });
  router.post(`${base}/draf/commit`, ({ params, body }) => services.imports.commitDraf(params.fothangId, body),
    { audit: 'Mengimpor file DRAF (mengganti data bulan terpilih)' });

  // Template Data (upload juga memakai endpoint upload yang sama).
  router.post(`${base}/template/preview`, ({ params, body }) => services.imports.previewTemplate(params.fothangId, body), { audit: false });
  router.post(`${base}/template/commit`, ({ params, body }) => services.imports.commitTemplate(params.fothangId, body),
    { audit: 'Mengimpor Template Data (mengganti data bulan terpilih)' });
};
