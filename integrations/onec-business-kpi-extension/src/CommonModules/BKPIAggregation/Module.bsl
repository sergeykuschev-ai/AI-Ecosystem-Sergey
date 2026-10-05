Function StoreCode(StoreName) Export
    Mapping = New Map;
    Mapping.Insert("Ампер", "amper");
    Mapping.Insert("Вентиль", "ventil");
    Mapping.Insert("Метиз маркет", "metiz-market");
    Mapping.Insert("Миска", "miska");
    Return Mapping.Get(TrimAll(StoreName));
EndFunction

Function EmptyRecord(Code, BusinessDate, SourceUpdatedAt) Export
    Record = New Structure;
    Record.Insert("recordId", Code + ":" + Format(BusinessDate, "DF=yyyy-MM-dd"));
    Record.Insert("storeCode", Code);
    Record.Insert("businessDate", Format(BusinessDate, "DF=yyyy-MM-dd"));
    Record.Insert("sourceUpdatedAt", Format(SourceUpdatedAt, "DF=yyyy-MM-dd'T'HH:mm:ssxxx"));
    Fields = New Array;
    Fields.Add("cash");
    Fields.Add("acquiring");
    Fields.Add("qr");
    Fields.Add("b2b");
    Fields.Add("b2bOrders");
    Fields.Add("receipts");
    Fields.Add("itemsSold");
    Fields.Add("retailSales");
    Fields.Add("retailReturns");
    Fields.Add("cashReturns");
    Fields.Add("cardReturns");
    Fields.Add("qrReturns");
    Fields.Add("returnReceipts");
    For Each Name In Fields Do
        Record.Insert(Name, 0);
    EndDo;
    Record.Insert("cashiers", New Array);
    Record.Insert("sourceDocuments", New Array);
    Record.Insert("organizationRefs", New Array);
    Return Record;
EndFunction

Procedure ApplyDocument(Record, Row, Cashiers, Organizations) Export
    If Row.DocumentType = "retail_sale" Then
        Record.cash = Record.cash + Row.Cash;
        Record.acquiring = Record.acquiring + Row.Card + Row.QR;
        Record.qr = Record.qr + Row.QR;
        Record.retailSales = Record.retailSales + Row.Cash + Row.Card + Row.QR;
        Record.receipts = Record.receipts + 1;
        Record.itemsSold = Record.itemsSold + Row.Items;
        AddCashier(Cashiers, Row);
    ElsIf Row.DocumentType = "retail_return" Then
        Record.cash = Record.cash - Row.Cash;
        Record.acquiring = Record.acquiring - Row.Card - Row.QR;
        Record.qr = Record.qr - Row.QR;
        Record.retailReturns = Record.retailReturns + Row.Cash + Row.Card + Row.QR;
        Record.cashReturns = Record.cashReturns + Row.Cash;
        Record.cardReturns = Record.cardReturns + Row.Card;
        Record.qrReturns = Record.qrReturns + Row.QR;
        Record.returnReceipts = Record.returnReceipts + 1;
        Record.itemsSold = Record.itemsSold - Row.Items;
    ElsIf Row.DocumentType = "b2b_shipment" Then
        Record.b2b = Record.b2b + Row.Amount;
        Record.b2bOrders = Record.b2bOrders + 1;
        Record.itemsSold = Record.itemsSold + Row.Items;
    EndIf;
    AddSourceDocument(Record.sourceDocuments, Row);
    If Not IsBlankString(Row.OrganizationRef) Then
        Organizations.Insert(Row.OrganizationRef, True);
    EndIf;
EndProcedure
Procedure AddCashier(Cashiers, Row)
    If IsBlankString(Row.CashierRef) Then Return; EndIf;
    Cashier = Cashiers.Get(Row.CashierRef);
    If Cashier = Undefined Then
        Cashier = New Structure("ref,code,name,receipts,itemsSold",
            Row.CashierRef, Row.CashierCode, Row.CashierName, 0, 0);
        Cashiers.Insert(Row.CashierRef, Cashier);
    EndIf;
    Cashier.receipts = Cashier.receipts + 1;
    Cashier.itemsSold = Cashier.itemsSold + Row.Items;
EndProcedure

Procedure AddSourceDocument(Documents, Row)
    Item = New Structure;
    Item.Insert("type", Row.DocumentType);
    Item.Insert("ref", Row.DocumentRef);
    Item.Insert("number", Row.DocumentNumber);
    Item.Insert("postedAt", Row.PostedAt);
    Item.Insert("updatedAt", Row.UpdatedAt);
    Item.Insert("warehouseRef", Row.WarehouseRef);
    Item.Insert("organizationRef", Row.OrganizationRef);
    Item.Insert("cashierRef", Row.CashierRef);
    Documents.Add(Item);
EndProcedure
