import { Map, List, fromJS } from 'immutable';
import _ from 'lodash';

import {
  parseOrg,
  parseTitleLine,
  parseRawText,
  parseLinksAndCookies,
  newHeaderWithTitle,
  newHeaderFromText,
} from '../lib/parse_org';
import {
  attributedStringToRawText,
} from '../lib/export_org';
import {
  indexOfHeaderWithId,
  headerWithId,
  parentIdOfHeaderWithId,
  subheadersOfHeaderWithId,
  numSubheadersOfHeaderWithId,
  indexOfPreviousSibling,
  openDirectParent,
  openHeaderWithPath,
  nextVisibleHeaderAfterIndex,
  previousVisibleHeaderAfterIndex,
  updateTableContainingCellId,
  newEmptyTableRowLikeRows,
  newEmptyTableCell,
  headerThatContainsTableCellId,
  headerWithPath,
  pathAndPartOfListItemWithIdInHeaders,
} from '../lib/org_utils';

const displayFile = (state, action) => {
  const parsedFile = parseOrg(action.contents);

  return state
    .set('path', action.path)
    .set('contents', action.contents)
    .set('headers', parsedFile.get('headers'))
    .set('todoKeywordSets', parsedFile.get('todoKeywordSets'));
};

const stopDisplayingFile = state => (
  state
    .set('path', null)
    .set('contents', null)
    .set('headers', null)
    .set('todoKeywordSets', null)
);

const openHeader = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  return state.setIn(['headers', headerIndex, 'opened'], true);
};

const toggleHeaderOpened = (state, action) => {
  const headers = state.get('headers');

  const headerIndex = indexOfHeaderWithId(headers, action.headerId);
  const isOpened = headerWithId(headers, action.headerId).get('opened');

  if (isOpened && state.get('focusedHeaderId') === action.headerId) {
    return state;
  }

  if (isOpened) {
    const subheaders = subheadersOfHeaderWithId(headers, action.headerId);
    subheaders.forEach((subheader, index) => {
      state = state.setIn(['headers', headerIndex + index + 1, 'opened'], false);
    });
  }

  return state.setIn(['headers', headerIndex, 'opened'], !isOpened);
};

const selectHeader = (state, action) => {
  return state.set('selectedHeaderId', action.headerId);
};

const todoKeywordSetForKeyword = (todoKeywordSets, keyword) => (
  todoKeywordSets.find(keywordSet => (
    keywordSet.get('keywords').contains(keyword)
  )) || todoKeywordSets.first()
);

const updateCookiesOfParentOfHeaderWithId = (state, headerId) => {
  const headers = state.get('headers');
  const parentHeaderId = parentIdOfHeaderWithId(headers, headerId);
  if (!parentHeaderId) {
    return state;
  }

  const subheaders = subheadersOfHeaderWithId(headers, parentHeaderId);

  const directChildren = [];
  for (let i = 0; i < subheaders.size; ++i) {
    const subheader = subheaders.get(i);
    directChildren.push(subheader);

    const subheaderSubheaders = subheadersOfHeaderWithId(headers, subheader.get('id'));
    i += subheaderSubheaders.size;
  }

  const directChildrenCompletionStates = directChildren.map(header => (
    header.getIn(['titleLine', 'todoKeyword'])
  )).filter(todoKeyword => !!todoKeyword).map(todoKeyword => (
    todoKeywordSetForKeyword(state.get('todoKeywordSets'), todoKeyword)
      .get('completedKeywords')
      .contains(todoKeyword)
  ));

  const parentHeaderIndex = indexOfHeaderWithId(headers, parentHeaderId);
  const parentHeader = headers.get(parentHeaderIndex);

  const doneCount = directChildrenCompletionStates.filter(done => done).length;
  const totalCount = directChildrenCompletionStates.length;
  const newParentHeader = parentHeader.updateIn(['titleLine', 'title'], title => (
    title.map(titlePart => {
      switch (titlePart.get('type')) {
      case 'fraction-cookie':
        return titlePart.set('fraction', List([doneCount, totalCount]));
      case 'percentage-cookie':
        return titlePart.set('percentage', Math.floor(doneCount / totalCount * 100));
      default:
        return titlePart;
      }
    })
  ));
  console.log("newParentHeader = ", newParentHeader.toJS());

  // TODO: update the raw title too.

  return state.setIn(['headers', parentHeaderIndex], newParentHeader);
};

const advanceTodoState = (state, action) => {
  const headerId = state.get('selectedHeaderId');
  if (!headerId) {
    return state;
  }

  const headers = state.get('headers');
  const header = headerWithId(headers, headerId);
  const headerIndex = indexOfHeaderWithId(headers, headerId);

  const currentTodoState = header.getIn(['titleLine', 'todoKeyword']);
  const currentTodoSet = todoKeywordSetForKeyword(state.get('todoKeywordSets'), currentTodoState);

  const currentStateIndex = currentTodoSet.get('keywords').indexOf(currentTodoState);
  const newStateIndex = currentStateIndex + 1;
  const newTodoState = currentTodoSet.get('keywords').get(newStateIndex) || '';

  state = state.setIn(['headers', headerIndex, 'titleLine', 'todoKeyword'], newTodoState);
  state = updateCookiesOfParentOfHeaderWithId(state, headerId);

  return state;
};

const updateHeaderTitle = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  const newTitleLine = parseTitleLine(action.newRawTitle, state.get('todoKeywordSets'));

  return state.setIn(['headers', headerIndex, 'titleLine'], newTitleLine);
};

const updateHeaderDescription = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  return state.updateIn(['headers', headerIndex], header => (
    header
      .set('rawDescription', action.newRawDescription)
      .set('description', parseRawText(action.newRawDescription))
  ));
};

const addHeader = (state, action) => {
  const headers = state.get('headers');
  const header = headerWithId(headers, action.headerId);
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);

  const newHeader = newHeaderWithTitle('',
                                       header.get('nestingLevel'),
                                       state.get('todoKeywordSets'));

  if (action.headerId === state.get('focusedHeaderId')) {
    state = state.set('focusedHeaderId', null);
  }

  return state.update('headers', headers => (
    headers.insert(headerIndex + subheaders.size + 1, newHeader)
  ));
};

const selectNextSiblingHeader = (state, action) => {
  const headers = state.get('headers');
  const header = headerWithId(headers, action.headerId);
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);
  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);

  const nextSibling = headers.get(headerIndex + subheaders.size + 1);

  if (!nextSibling || nextSibling.get('nestingLevel') !== header.get('nestingLevel')) {
    return state;
  }

  return state.set('selectedHeaderId', nextSibling.get('id'));
};

const selectNextVisibleHeader = (state, action) => {
  const headers = state.get('headers');

  if (state.get('selectedHeaderId') === undefined) {
    return state.set('selectedHeaderId', headers.getIn([0, 'id']));
  }

  const headerIndex = indexOfHeaderWithId(headers, state.get('selectedHeaderId'));

  const nextVisibleHeader = nextVisibleHeaderAfterIndex(headers, headerIndex);

  if (!nextVisibleHeader) {
    return state;
  }

  return state.set('selectedHeaderId', nextVisibleHeader.get('id'));
};

const selectPreviousVisibleHeader = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, state.get('selectedHeaderId'));

  const previousVisibleHeader = previousVisibleHeaderAfterIndex(headers, headerIndex);

  if (!previousVisibleHeader) {
    return state;
  }

  return state.set('selectedHeaderId', previousVisibleHeader.get('id'));
};

const removeHeader = (state, action) => {
  let headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);
  const numHeadersToRemove = 1 + subheaders.size;

  _.times(numHeadersToRemove).forEach(() => {
    headers = headers.delete(headerIndex);
  });

  if (action.headerId === state.get('focusedHeaderId')) {
    state = state.set('focusedHeaderId', null);
  }

  return state.set('headers', headers);
};

const moveHeaderUp = (state, action) => {
  let headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  const previousSiblingIndex = indexOfPreviousSibling(headers, headerIndex);
  if (previousSiblingIndex === null) {
    return state;
  }

  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);
  _.times(1 + subheaders.size).forEach(() => {
    headers = headers.insert(previousSiblingIndex, headers.get(headerIndex + subheaders.size));
    headers = headers.delete(headerIndex + subheaders.size + 1);
  });

  return state.set('headers', headers);
};

const moveHeaderDown = (state, action) => {
  let headers = state.get('headers');
  const header = headerWithId(headers, action.headerId);
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);
  const nextSiblingIndex = headerIndex + subheaders.size + 1;
  const nextSibling = headers.get(nextSiblingIndex);
  if (nextSibling.get('nestingLevel') < header.get('nestingLevel')) {
    return state;
  }

  const nextSiblingSubheaders = subheadersOfHeaderWithId(headers, nextSibling.get('id'));
  _.times(1 + nextSiblingSubheaders.size).forEach(() => {
    headers = headers.insert(headerIndex, headers.get(nextSiblingIndex + nextSiblingSubheaders.size));
    headers = headers.delete(nextSiblingIndex + nextSiblingSubheaders.size + 1);
  });

  return state.set('headers', headers);
};

const moveHeaderLeft = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  return state.updateIn(['headers', headerIndex, 'nestingLevel'], nestingLevel => (
    Math.max(nestingLevel - 1, 1)
  ));
};

const moveHeaderRight = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  state = state.updateIn(['headers', headerIndex, 'nestingLevel'], nestingLevel => (
    nestingLevel + 1
  ));

  return openDirectParent(state, action.headerId);
};

const moveSubtreeLeft = (state, action) => {
  const headers = state.get('headers');
  const header = headerWithId(headers, action.headerId);
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  if (header.get('nestingLevel') === 1) {
    return state;
  }

  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);

  state = state.updateIn(['headers', headerIndex, 'nestingLevel'], nestingLevel => (
    nestingLevel - 1
  ));

  subheaders.forEach((_, index) => {
    state = state.updateIn(['headers', headerIndex + index + 1, 'nestingLevel'], nestingLevel => (
      nestingLevel - 1
    ));
  });

  return state;
};

const moveSubtreeRight = (state, action) => {
  const headers = state.get('headers');
  const headerIndex = indexOfHeaderWithId(headers, action.headerId);

  const subheaders = subheadersOfHeaderWithId(headers, action.headerId);

  state = state.updateIn(['headers', headerIndex, 'nestingLevel'], nestingLevel => (
    nestingLevel + 1
  ));
  subheaders.forEach((_, index) => {
    state = state.updateIn(['headers', headerIndex + index + 1, 'nestingLevel'], nestingLevel => (
      nestingLevel + 1
    ));
  });

  return openDirectParent(state, action.headerId);
};

const focusHeader = (state, action) => {
  return state.set('focusedHeaderId', action.headerId);
};

const unfocusHeader = state => (
  state.set('focusedHeaderId', null)
);

const noOp = state => (
  state.update('noOpCounter', counter => (counter || 0) + 1)
);

const applyOpennessState = (state, action) => {
  const opennessState = state.get('opennessState');
  if (!opennessState) {
    return state;
  }

  const fileOpennessState = opennessState.get(state.get('path'));
  if (!fileOpennessState || fileOpennessState.size === 0) {
    return state;
  }

  let headers = state.get('headers');
  fileOpennessState.forEach(openHeaderPath => {
    headers = openHeaderWithPath(headers, openHeaderPath);
  });

  return state.set('headers', headers);
};

const setDirty = (state, action) => (
  state.set('isDirty', action.isDirty)
);

const setSelectedTableCellId = (state, action) => (
  state.set('selectedTableCellId', action.cellId)
);

const enterTableEditMode = (state, action) => {
  if (!state.get('selectedTableCellId')) {
    return state;
  }

  return state.set('inTableEditMode', true);
};

const exitTableEditMode = (state, action) => {
  if (!state.get('selectedTableCellId')) {
    return state;
  }

  return state.set('inTableEditMode', false);
};

const updateDescriptionOfHeaderContainingTableCell = (state, cellId, header = null) => {
  const headers = state.get('headers');
  if (!header) {
    header = headerThatContainsTableCellId(headers, cellId);
  }
  const headerIndex = indexOfHeaderWithId(headers, header.get('id'));

  return state.updateIn(['headers', headerIndex], header => (
    header.set('rawDescription', attributedStringToRawText(header.get('description')))
  ));
};

const addNewTableRow = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, rowIndex => rows => (
      rows.insert(rowIndex + 1, newEmptyTableRowLikeRows(rows))
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId);
};

const removeTableRow = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  const containingHeader = headerThatContainsTableCellId(state.get('headers'), selectedTableCellId);

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, rowIndex => rows => (
      rows.delete(rowIndex)
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId, containingHeader);
};

const addNewTableColumn = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, (_rowIndex, colIndex) => rows => (
      rows.map(row => (
        row.update('contents', contents => (
          contents.insert(colIndex + 1, newEmptyTableCell())
        ))
      ))
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId);
};

const removeTableColumn = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  const containingHeader = headerThatContainsTableCellId(state.get('headers'), selectedTableCellId);

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, (_rowIndex, colIndex) => rows => (
      rows.map(row => (
        row.update('contents', contents => (
          contents.delete(colIndex)
        ))
      ))
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId, containingHeader);
};

const moveTableRowDown = state => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, rowIndex => rows => (
      rowIndex + 1 === rows.size ? (
        rows
      ) : (
        rows
          .insert(rowIndex, rows.get(rowIndex + 1))
          .delete(rowIndex + 2)
      )
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId);
};

const moveTableRowUp = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, rowIndex => rows => (
      rowIndex === 0 ? (
        rows
      ) : (
        rows
          .insert(rowIndex - 1, rows.get(rowIndex))
          .delete(rowIndex + 1)
      )
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId);
};

const moveTableColumnLeft = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, (_rowIndex, columnIndex) => rows => (
      columnIndex === 0 ? (
        rows
      ) : (
        rows.map(row => (
          row.update('contents', contents => (
            contents.size === 0 ? (
              contents
            ) : (
              contents
                .insert(columnIndex - 1, contents.get(columnIndex))
                .delete(columnIndex + 1)
            )
          ))
        ))
      )
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId);
};

const moveTableColumnRight = (state, action) => {
  const selectedTableCellId = state.get('selectedTableCellId');
  if (!selectedTableCellId) {
    return state;
  }

  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, selectedTableCellId, (_rowIndex, columnIndex) => rows => (
      columnIndex + 1 >= rows.getIn([0, 'contents']).size ? (
        rows
      ) : (
        rows.map(row => (
          row.update('contents', contents => (
            contents.size === 0 ? (
              contents
            ) : (
              contents
                .insert(columnIndex, contents.get(columnIndex + 1))
                .delete(columnIndex + 2)
            )
          ))
        ))
      )
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, selectedTableCellId);
};

const updateTableCellValue = (state, action) => {
  state = state.update('headers', headers => (
    updateTableContainingCellId(headers, action.cellId, (rowIndex, colIndex) => rows => (
      rows.updateIn([rowIndex, 'contents', colIndex], cell => (
        cell
          .set('rawContents', action.newValue)
          .set('contents', fromJS(parseLinksAndCookies(action.newValue, { excludeCookies: true })))
      ))
    ))
  ));

  return updateDescriptionOfHeaderContainingTableCell(state, action.cellId);
};

const insertCapture = (state, action) => {
  const headers = state.get('headers');
  const { template, content } = action;

  const parentHeader = headerWithPath(headers, template.get('headerPaths'));
  if (!parentHeader) {
    return state;
  }

  const newHeader = newHeaderFromText(content, state.get('todoKeywordSets'))
      .set('nestingLevel', parentHeader.get('nestingLevel') + 1);

  const parentHeaderIndex = indexOfHeaderWithId(headers, parentHeader.get('id'));
  const numSubheaders = numSubheadersOfHeaderWithId(headers, parentHeader.get('id'));
  const newIndex = parentHeaderIndex + 1 + (template.get('shouldPrepend') ? 0 : numSubheaders);

  return state.update('headers', headers => (
    headers.insert(newIndex, newHeader)
  ));
};

const updateParentListCheckboxes = (state, itemPath) => {
  const parentListItemPath = itemPath.slice(0, itemPath.length - 4);
  const parentListItem = state.getIn(parentListItemPath);
  if (!parentListItem.get('isCheckbox')) {
    return state;
  }

  const childrenCheckedStates = parentListItem.get('contents').filter(part => (
    part.get('type') === 'list'
  )).flatMap(listPart => (
    listPart.get('items').filter(item => (
      item.get('isCheckbox')
    )).map(checkboxItem => checkboxItem.get('checkboxState'))
  ));

  if (childrenCheckedStates.every(state => state === 'checked')) {
    state = state.setIn(parentListItemPath.concat(['checkboxState']), 'checked');
  } else if (childrenCheckedStates.every(state => state === 'unchecked')) {
    state = state.setIn(parentListItemPath.concat(['checkboxState']), 'unchecked');
  } else {
    state = state.setIn(parentListItemPath.concat(['checkboxState']), 'partial');
  }

  return updateParentListCheckboxes(state, parentListItemPath);
};

const advanceCheckboxState = (state, action) => {
  const pathAndPart = pathAndPartOfListItemWithIdInHeaders(state.get('headers'), action.listItemId);
  const { path, listItemPart } = pathAndPart;

  const hasDirectCheckboxChildren = listItemPart.get('contents').filter(part => (
    part.get('type') === 'list'
  )).some(listPart => (
    listPart.get('items').some(item => (
      item.get('isCheckbox')
    ))
  ));
  if (hasDirectCheckboxChildren) {
    return state;
  }

  const newCheckboxState = {
    'checked': 'unchecked',
    'unchecked': 'checked',
    'partial': 'unchecked',
  }[listItemPart.get('checkboxState')];

  state = state.setIn(['headers'].concat(path).concat(['checkboxState']), newCheckboxState);
  state = updateParentListCheckboxes(state, ['headers'].concat(path));

  const headerIndex = path[0];
  state = state.updateIn(['headers', headerIndex], header => (
    header.set('rawDescription', attributedStringToRawText(header.get('description')))
  ));

  return state;
};

export default (state = new Map(), action) => {
  const dirtyingActions = [
    'ADVANCE_TODO_STATE', 'UPDATE_HEADER_TITLE', 'UPDATE_HEADER_DESCRIPTION',
    'ADD_HEADER', 'REMOVE_HEADER', 'MOVE_HEADER_UP',
    'MOVE_HEADER_DOWN', 'MOVE_HEADER_LEFT', 'MOVE_HEADER_RIGHT',
    'MOVE_SUBTREE_LEFT', 'MOVE_SUBTREE_RIGHT', 'ADD_NEW_TABLE_ROW', 'REMOVE_TABLE_ROW',
    'ADD_NEW_TABLE_COLUMN', 'Rif (EMOVE_TABLE_COLUMN', 'MOVE_TABLE_ROW_DOWN', 'MOVE_TABLE_ROW_UP',
    'MOVE_TABLE_COLUMN_LEFT', 'MOVE_TABLE_COLUMN_RIGHT', 'UPDATE_TABLE_CELL_VALUE',
    'INSERT_CAPTURE',
  ];

  if (dirtyingActions.includes(action.type)) {
    state = state.set('isDirty', true);
  }

  switch (action.type) {
  case 'DISPLAY_FILE':
    return displayFile(state, action);
  case 'STOP_DISPLAYING_FILE':
    return stopDisplayingFile(state, action);
  case 'TOGGLE_HEADER_OPENED':
    return toggleHeaderOpened(state, action);
  case 'OPEN_HEADER':
    return openHeader(state, action);
  case 'SELECT_HEADER':
    return selectHeader(state, action);
  case 'ADVANCE_TODO_STATE':
    return advanceTodoState(state, action);
  case 'ENTER_TITLE_EDIT_MODE':
    return state.set('inTitleEditMode', true);
  case 'EXIT_TITLE_EDIT_MODE':
    return state.set('inTitleEditMode', false);
  case 'UPDATE_HEADER_TITLE':
    return updateHeaderTitle(state, action);
  case 'ENTER_DESCRIPTION_EDIT_MODE':
    return state.set('inDescriptionEditMode', true);
  case 'EXIT_DESCRIPTION_EDIT_MODE':
    return state.set('inDescriptionEditMode', false);
  case 'UPDATE_HEADER_DESCRIPTION':
    return updateHeaderDescription(state, action);
  case 'ADD_HEADER':
    return addHeader(state, action);
  case 'SELECT_NEXT_SIBLING_HEADER':
    return selectNextSiblingHeader(state, action);
  case 'SELECT_NEXT_VISIBLE_HEADER':
    return selectNextVisibleHeader(state, action);
  case 'SELECT_PREVIOUS_VISIBLE_HEADER':
    return selectPreviousVisibleHeader(state, action);
  case 'REMOVE_HEADER':
    return removeHeader(state, action);
  case 'MOVE_HEADER_UP':
    return moveHeaderUp(state, action);
  case 'MOVE_HEADER_DOWN':
    return moveHeaderDown(state, action);
  case 'MOVE_HEADER_LEFT':
    return moveHeaderLeft(state, action);
  case 'MOVE_HEADER_RIGHT':
    return moveHeaderRight(state, action);
  case 'MOVE_SUBTREE_LEFT':
    return moveSubtreeLeft(state, action);
  case 'MOVE_SUBTREE_RIGHT':
    return moveSubtreeRight(state, action);
  case 'NO_OP':
    return noOp(state, action);
  case 'APPLY_OPENNESS_STATE':
    return applyOpennessState(state, action);
  case 'SET_DIRTY':
    return setDirty(state, action);
  case 'FOCUS_HEADER':
    return focusHeader(state, action);
  case 'UNFOCUS_HEADER':
    return unfocusHeader(state, action);
  case 'SET_SELECTED_TABLE_CELL_ID':
    return setSelectedTableCellId(state, action);
  case 'ENTER_TABLE_EDIT_MODE':
    return enterTableEditMode(state, action);
  case 'EXIT_TABLE_EDIT_MODE':
    return exitTableEditMode(state, action);
  case 'ADD_NEW_TABLE_ROW':
    return addNewTableRow(state, action);
  case 'REMOVE_TABLE_ROW':
    return removeTableRow(state, action);
  case 'ADD_NEW_TABLE_COLUMN':
    return addNewTableColumn(state, action);
  case 'REMOVE_TABLE_COLUMN':
    return removeTableColumn(state, action);
  case 'MOVE_TABLE_ROW_DOWN':
    return moveTableRowDown(state, action);
  case 'MOVE_TABLE_ROW_UP':
    return moveTableRowUp(state, action);
  case 'MOVE_TABLE_COLUMN_LEFT':
    return moveTableColumnLeft(state, action);
  case 'MOVE_TABLE_COLUMN_RIGHT':
    return moveTableColumnRight(state, action);
  case 'UPDATE_TABLE_CELL_VALUE':
    return updateTableCellValue(state, action);
  case 'INSERT_CAPTURE':
    return insertCapture(state, action);
  case 'ADVANCE_CHECKBOX_STATE':
    return advanceCheckboxState(state, action);
  default:
    return state;
  }
};
