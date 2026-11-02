// Everyday actions are separate from account settings and backup tools.
(() => {
  const el = id => document.getElementById(id);
  const productDialog = el('productDialog');
  const settings = el('dataDialog');
  let scope;
  function openProduct() {
    scope = window.PanCloud?.scopeToken();
    el('productForm').reset();
    el('productDate').value = localDateISO();
    el('productDate').max = localDateISO();
    el('productSection').value = currentPage === 'skincare-face' ? 'skFaceTableBody' : currentPage === 'skincare-body' ? 'skBodyTableBody' : 'tableBody';
    el('productMessage').textContent = '';
    productDialog.showModal();
  }
  function openSettings() { settings.showModal(); }
  document.querySelectorAll('[data-add-product]').forEach(b => b.addEventListener('click', openProduct));
  document.querySelectorAll('[data-open-settings]').forEach(b => b.addEventListener('click', openSettings));
  el('welcomeLogin').addEventListener('click', () => el('accountOpen').click());
  el('productCancel').addEventListener('click', () => productDialog.close());
  el('dataClose').addEventListener('click', () => settings.close());
  el('productForm').addEventListener('submit', event => {
    event.preventDefault();
    if (scope !== window.PanCloud?.scopeToken()) { productDialog.close(); return; }
    const name=el('productName'), category=el('productCategory'), date=el('productDate');
    name.setCustomValidity(name.value.trim() ? '' : 'Напиши название средства');
    category.setCustomValidity(category.value.trim() ? '' : 'Укажи категорию');
    date.setCustomValidity(validArchiveDate(date.value) ? '' : 'Укажи дату не позже сегодняшней');
    if (!el('productForm').reportValidity()) return;
    const key=el('productSection').value;
    const buyDateStr=isoToDisplay(date.value);
    const product={name:name.value.trim(),brand:el('productBrand').value.trim(),cat:category.value.trim(),color:el('productShade').value.trim(),price:Number(el('productPrice').value || 0),buyDateStr,buyDate:parseDate(buyDateStr),finished:false,endDateStr:null,endDate:null};
    if (key !== 'tableBody') product.section=key === 'skFaceTableBody' ? 'Уход за лицом' : 'Уход за телом';
    const groups=collectionGroups();
    const next={...groups,[key]:[...groups[key],product]};
    if (!persistCollections(next)) { el('productMessage').textContent='Не удалось сохранить средство. Проверь сообщение внизу экрана.'; return; }
    groups[key].push(product);
    productDialog.close();
    const page=key === 'tableBody' ? 'catalog' : key === 'skFaceTableBody' ? 'skincare-face' : 'skincare-body';
    showPage(page);
    // A user may have been looking at archived items or filtering the catalog.
    const config=key === 'tableBody' ? [cosCat,'searchInput'] : key === 'skFaceTableBody' ? [faceCat,'skFaceSearchInput'] : [bodyCat,'skBodySearchInput'];
    el(config[1]).value=''; config[0].setTag('__all__'); config[0].switchTab('active');
    toasts('Средство добавлено');
  });
  for (const id of ['productName','productCategory','productDate']) el(id).addEventListener('input', () => el(id).setCustomValidity(''));
  el('tableImport').addEventListener('change', event => {
    const file=event.target.files[0];
    if (!file) return;
    const names={tableBody:'cosmetics.csv',skFaceTableBody:'face.csv',skBodyTableBody:'body.csv'};
    handleCSVUpload(new File([file],names[el('tableSection').value],{type:file.type}));
    event.target.value='';
  });
  window.PanUI={closeEditor:()=>{ if(productDialog.open) productDialog.close(); }};
})();
